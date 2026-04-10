import { RPC_ALL_PROVIDERS_DOWN_CODE } from './rpcProxyHandler'
import { useRpcOverrideStore } from '../stores/useRpcOverrideStore'

const FAILURE_THRESHOLD = 2
let consecutiveFailures = 0

// Custom fetch for @solana/web3.js Connection. Wraps window.fetch to
// detect the proxy's "all providers down" error and trip the override
// banner after FAILURE_THRESHOLD consecutive occurrences. Successful
// responses reset the counter. Non-proxy errors (upstream RPC method
// errors returned with HTTP 200) pass through untouched.
export async function rpcFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init)

  if (response.ok) {
    consecutiveFailures = 0
    return response
  }

  if (response.status !== 503) {
    return response
  }

  // Clone so the caller can still read the body stream.
  const clone = response.clone()
  try {
    const parsed = await clone.json()
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
    // Non-JSON 503 from somewhere upstream — don't trip the banner.
  }

  return response
}
