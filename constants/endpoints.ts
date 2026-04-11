const MAINNET_PROXY_PATH = '/api/rpc/mainnet'
const DEVNET_PROXY_PATH = '/api/rpc/devnet'

// During SSR we don't have window.location. RPC calls only happen
// client-side, so this placeholder value is never actually fetched.
const SSR_PLACEHOLDER_BASE = 'http://localhost:3000'

function currentBase(): string {
  if (typeof window === 'undefined') return SSR_PLACEHOLDER_BASE
  return window.location.origin
}

export function getMainnetEndpoint(override?: string | null): string {
  if (override && override.trim()) return override.trim()
  return `${currentBase()}${MAINNET_PROXY_PATH}`
}

export function getDevnetEndpoint(override?: string | null): string {
  if (override && override.trim()) return override.trim()
  return `${currentBase()}${DEVNET_PROXY_PATH}`
}

// Legacy constants for callers that import MAINNET_RPC / DEVNET_RPC
// directly (e.g., utils/connection.ts). New code should prefer the
// getter functions so it can read the user override from the store.
export const MAINNET_RPC = getMainnetEndpoint()
export const DEVNET_RPC = getDevnetEndpoint()
