import { NextApiRequest, NextApiResponse } from 'next'
import { withSentry } from '@sentry/nextjs'
import axios, { AxiosError } from 'axios'

// Custom JSON-RPC error code for "all internal providers unavailable".
// Reserved server-error range is -32099..-32000. The client detects this
// code in rpcFetch and trips the override banner.
export const RPC_ALL_PROVIDERS_DOWN_CODE = -32098

const PROXY_TIMEOUT_MS = 8000

// JSON-RPC methods the proxy is willing to forward. Keep tight; expand
// only when a real code path breaks because a needed method is missing.
const ALLOWED_METHODS = new Set<string>([
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getBalance',
  'getMinimumBalanceForRentExemption',
  'getTokenAccountsByOwner',
  'getTokenAccountBalance',
  'getTokenSupply',
  'getLatestBlockhash',
  'getRecentBlockhash',
  'getSlot',
  'getBlockHeight',
  'getEpochInfo',
  'getVersion',
  'getGenesisHash',
  'getSignatureStatuses',
  'getSignatureStatus',
  'getSignaturesForAddress',
  'getTransaction',
  'getConfirmedTransaction',
  'getConfirmedSignaturesForAddress2',
  'sendTransaction',
  'simulateTransaction',
  'getFeeForMessage',
  'getRecentPrioritizationFees',
  'getInflationReward',
  'getParsedAccountInfo',
  'getParsedTokenAccountsByOwner',
  'getParsedTransaction',
])

type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: JsonRpcError
}

type ForwardResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: string }

async function forwardTo(url: string, body: unknown): Promise<ForwardResult> {
  try {
    const res = await axios.post(url, body, {
      timeout: PROXY_TIMEOUT_MS,
      headers: { 'content-type': 'application/json' },
      validateStatus: () => true,
    })
    if (res.status >= 400) {
      return { ok: false, reason: `HTTP ${res.status}` }
    }
    return { ok: true, body: res.data }
  } catch (e) {
    const err = e as AxiosError
    if (err.code === 'ECONNABORTED') return { ok: false, reason: 'timeout' }
    return { ok: false, reason: err.code || err.message || 'network error' }
  }
}

// Triton's RPC backend has a bug where JSON-RPC batched requests whose
// items are all `getProgramAccounts` calls on
// `BPFLoaderUpgradeab1e11111111111111111111111` return a single
// `-32700` parse-error response instead of a batched response. This
// breaks governance-ui's program-governance discovery (used by every
// Adrena admin form's Governance dropdown). Detect that pattern and
// retry by forwarding each batched item as an individual request in
// parallel, then recombining into a batch-shaped response.
function looksLikeBatchParseBug(body: unknown): boolean {
  return (
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    typeof (body as { error?: unknown }).error === 'object' &&
    (body as { error?: { code?: number } }).error?.code === -32700
  )
}

async function forwardWithUnbatchFallback(
  url: string,
  body: unknown,
): Promise<ForwardResult> {
  const result = await forwardTo(url, body)

  // Pass through unless: upstream succeeded at HTTP level, original was
  // a batch, and the response body matches the Triton batch parse-error
  // bug shape (single object with error.code -32700).
  if (!result.ok) return result
  if (!Array.isArray(body)) return result
  if (!looksLikeBatchParseBug(result.body)) return result

  // Workaround: forward each batched item as an individual request.
  const batch = body as unknown[]
  const individual = await Promise.all(
    batch.map((item) => forwardTo(url, item)),
  )

  // If any sub-request failed at network level, surface the failure so
  // the existing primary -> backup fallback can take over.
  for (const r of individual) {
    if (!r.ok) return r
  }

  // If any sub-request also tripped the same bug, our workaround did
  // not help — surface as failure for the same reason.
  const stillBuggy = individual.some((r) =>
    looksLikeBatchParseBug((r as { ok: true; body: unknown }).body),
  )
  if (stillBuggy) {
    return { ok: false, reason: 'batch parse bug persisted after unbatching' }
  }

  const combined = individual.map(
    (r) => (r as { ok: true; body: unknown }).body,
  )
  return { ok: true, body: combined }
}

function validateMethods(
  body: unknown,
): { ok: true } | { ok: false; offending: string } {
  const requests = Array.isArray(body) ? body : [body]
  for (const r of requests) {
    if (!r || typeof r !== 'object') {
      return { ok: false, offending: '<malformed request>' }
    }
    const method = (r as { method?: unknown }).method
    if (typeof method !== 'string') {
      return { ok: false, offending: '<missing method>' }
    }
    if (!ALLOWED_METHODS.has(method)) {
      return { ok: false, offending: method }
    }
  }
  return { ok: true }
}

function buildAllDownBody(
  original: unknown,
  primaryErr: string,
  backupErr: string,
): JsonRpcResponse | JsonRpcResponse[] {
  const err: JsonRpcError = {
    code: RPC_ALL_PROVIDERS_DOWN_CODE,
    message: 'All internal RPC providers unavailable',
    data: { primary: primaryErr, backup: backupErr },
  }
  const mkResp = (id: string | number | null): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: err,
  })
  if (Array.isArray(original)) {
    return original.map((r) =>
      mkResp((r as { id?: string | number | null })?.id ?? null),
    )
  }
  return mkResp((original as { id?: string | number | null })?.id ?? null)
}

export function createRpcProxyHandler(
  primaryEnvKey: string,
  backupEnvKey: string,
) {
  // TODO: add Origin allowlist when ready to tighten. Currently any origin
  // that can reach this route can call it; the method allowlist is the
  // only defense-in-depth layer.
  const handler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'method not allowed' })
    }

    const primary = process.env[primaryEnvKey]
    const backup = process.env[backupEnvKey]
    if (!primary) {
      return res
        .status(500)
        .json({ error: `${primaryEnvKey} not configured` })
    }

    const body = req.body
    const methodCheck = validateMethods(body)
    if (!methodCheck.ok) {
      return res.status(422).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32601,
          message: `Method not allowed by proxy: ${methodCheck.offending}`,
        },
      })
    }

    const primaryResult = await forwardWithUnbatchFallback(primary, body)
    if (primaryResult.ok) {
      res.setHeader('X-RPC-Served-By', 'primary')
      return res.status(200).json(primaryResult.body)
    }

    if (!backup) {
      res.setHeader('X-RPC-Served-By', 'none')
      return res
        .status(503)
        .json(
          buildAllDownBody(body, primaryResult.reason, 'no backup configured'),
        )
    }

    const backupResult = await forwardWithUnbatchFallback(backup, body)
    if (backupResult.ok) {
      res.setHeader('X-RPC-Served-By', 'backup')
      return res.status(200).json(backupResult.body)
    }

    res.setHeader('X-RPC-Served-By', 'none')
    return res
      .status(503)
      .json(buildAllDownBody(body, primaryResult.reason, backupResult.reason))
  }

  return withSentry(handler)
}

// Exported so route files can re-export it. Next.js requires the `config`
// export at the top level of the route file, not the factory.
export const rpcProxyRouteConfig = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}
