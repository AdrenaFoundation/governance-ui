import { RPC_ALL_PROVIDERS_DOWN_CODE } from './rpcProxyHandler'
import { useRpcOverrideStore } from '../stores/useRpcOverrideStore'

const FAILURE_THRESHOLD = 2
let consecutiveFailures = 0

// Short-lived cache keyed by method+params. Coalesces concurrent and
// immediately-repeated identical requests so the page-load burst of
// duplicate account lookups (USDC mint info queried 200+ times, etc.)
// does not round-trip each one to the proxy. TTL is intentionally small:
// long enough to catch the initial-load flurry, short enough that
// staleness never surprises anyone.
const DEDUP_TTL_MS = 5000

// Methods that must NEVER be cached — writes and freshness-sensitive
// reads. Everything not in this set is cacheable within the TTL window.
const NON_CACHEABLE_METHODS: ReadonlySet<string> = new Set([
  // Writes / mutating
  'sendTransaction',
  'simulateTransaction',
  'requestAirdrop',
  // Freshness-sensitive reads (block state, confirmation polling, health)
  'getLatestBlockhash',
  'getRecentBlockhash',
  'getSlot',
  'getBlockHeight',
  'getSignatureStatuses',
  'getSignatureStatus',
  'getSignaturesForAddress',
  'getHealth',
])

// Responses are cached in a "frozen" form (body text + status + headers)
// rather than as Response objects. Response clone semantics are subtle;
// reconstructing a fresh Response from frozen fields on every cache read
// leaves each consumer with an unconsumed body stream and avoids any
// "already consumed" traps that can arise from repeated .clone() chains.
type FrozenResponse = {
  bodyText: string
  status: number
  statusText: string
  headers: Record<string, string>
}

type CacheEntry = {
  expires: number
  frozen: FrozenResponse
}

const responseCache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<FrozenResponse>>()

function computeCacheKey(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  if (Array.isArray(body)) return null // batched requests skip the cache
  const method = (body as { method?: unknown }).method
  if (typeof method !== 'string') return null
  if (NON_CACHEABLE_METHODS.has(method)) return null
  const params = (body as { params?: unknown }).params
  return `${method}:${JSON.stringify(params ?? null)}`
}

function pruneExpired(now: number): void {
  for (const [k, v] of responseCache) {
    if (v.expires <= now) responseCache.delete(k)
  }
}

async function fetchAndFreeze(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FrozenResponse> {
  const response = await fetch(input, init)
  const bodyText = await response.text()
  return {
    bodyText,
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  }
}

function checkBannerSignal(frozen: FrozenResponse): void {
  if (frozen.status >= 200 && frozen.status < 300) {
    consecutiveFailures = 0
    return
  }
  if (frozen.status !== 503) return

  try {
    const parsed = JSON.parse(frozen.bodyText)
    const responses = Array.isArray(parsed) ? parsed : [parsed]
    const allDown = responses.some(
      (r: { error?: { code?: number } }) =>
        r?.error?.code === RPC_ALL_PROVIDERS_DOWN_CODE,
    )
    if (allDown) {
      consecutiveFailures += 1
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        useRpcOverrideStore.getState().setInternalRpcDown(true)
      }
    }
  } catch {
    // Non-JSON 503 body — don't trip the banner.
  }
}

function materialize(frozen: FrozenResponse): Response {
  return new Response(frozen.bodyText, {
    status: frozen.status,
    statusText: frozen.statusText,
    headers: frozen.headers,
  })
}

// Custom fetch for @solana/web3.js Connection. Three layers on top of
// the raw fetch:
//   1. Dedup cache — identical (method + params) requests served from
//      a frozen in-memory cache within DEDUP_TTL_MS.
//   2. In-flight coalescing — concurrent callers for the same key share
//      one upstream request.
//   3. Banner signal — 503 responses whose body contains the proxy's
//      "all providers down" error code trip the user-override banner
//      after FAILURE_THRESHOLD consecutive occurrences.
// Non-cacheable methods (writes, freshness-sensitive reads) skip layers
// 1 and 2 entirely and go straight through to the upstream.
export async function rpcFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Parse the request body so we can compute a dedup key. Only JSON
  // string bodies are cacheable; anything else (ArrayBuffer, Blob,
  // URLSearchParams, undefined) falls through to a direct fetch.
  let body: unknown = null
  if (init?.body && typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body)
    } catch {
      // Not JSON — skip dedup.
    }
  }

  const key = body !== null ? computeCacheKey(body) : null

  if (key === null) {
    // Non-cacheable path — fire directly, still run the banner check.
    const frozen = await fetchAndFreeze(input, init)
    checkBannerSignal(frozen)
    return materialize(frozen)
  }

  const now = Date.now()
  pruneExpired(now)

  // 1. Response cache hit — recent 2xx for this key, replay it.
  const cached = responseCache.get(key)
  if (cached && cached.expires > now) {
    return materialize(cached.frozen)
  }

  // 2. In-flight coalescing — another caller has a live request for
  // this exact key. Share its promise so upstream is hit exactly once
  // regardless of how many concurrent callers arrive.
  const pending = inflight.get(key)
  if (pending) {
    try {
      const sharedFrozen = await pending
      return materialize(sharedFrozen)
    } catch {
      // The shared promise rejected — fall through and retry fresh.
    }
  }

  // 3. Fire a fresh request. Register as in-flight BEFORE awaiting the
  // network call so concurrent callers arriving mid-flight can coalesce
  // onto this same promise.
  const freshPromise = (async () => {
    const frozen = await fetchAndFreeze(input, init)
    checkBannerSignal(frozen)
    if (frozen.status >= 200 && frozen.status < 300) {
      responseCache.set(key, {
        expires: Date.now() + DEDUP_TTL_MS,
        frozen,
      })
    }
    return frozen
  })()

  inflight.set(key, freshPromise)

  try {
    const frozen = await freshPromise
    return materialize(frozen)
  } finally {
    // Clear the in-flight marker whether success or failure so the next
    // call starts a fresh request if needed. Cache will serve hits for
    // successful 2xx responses, cache-miss for everything else.
    inflight.delete(key)
  }
}
