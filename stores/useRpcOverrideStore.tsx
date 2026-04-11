import create from 'zustand'

type Cluster = 'mainnet' | 'devnet'

interface RpcOverrideState {
  mainnetOverride: string | null
  devnetOverride: string | null
  isInternalRpcDown: boolean
  setOverride: (cluster: Cluster, url: string) => void
  clearOverride: (cluster: Cluster) => void
  setInternalRpcDown: (value: boolean) => void
}

const SESSION_KEY_MAINNET = 'rpc-override-mainnet'
const SESSION_KEY_DEVNET = 'rpc-override-devnet'

function readSession(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSession(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key)
    } else {
      window.sessionStorage.setItem(key, value)
    }
  } catch {
    // sessionStorage unavailable (privacy mode, quota) — non-fatal
  }
}

export const useRpcOverrideStore = create<RpcOverrideState>((set) => ({
  mainnetOverride: readSession(SESSION_KEY_MAINNET),
  devnetOverride: readSession(SESSION_KEY_DEVNET),
  isInternalRpcDown: false,
  setOverride: (cluster, url) => {
    const trimmed = url.trim()
    if (cluster === 'mainnet') {
      writeSession(SESSION_KEY_MAINNET, trimmed)
      set({ mainnetOverride: trimmed, isInternalRpcDown: false })
    } else {
      writeSession(SESSION_KEY_DEVNET, trimmed)
      set({ devnetOverride: trimmed, isInternalRpcDown: false })
    }
  },
  clearOverride: (cluster) => {
    if (cluster === 'mainnet') {
      writeSession(SESSION_KEY_MAINNET, null)
      set({ mainnetOverride: null })
    } else {
      writeSession(SESSION_KEY_DEVNET, null)
      set({ devnetOverride: null })
    }
  },
  setInternalRpcDown: (value) => set({ isInternalRpcDown: value }),
}))
