import React, { useState } from 'react'
import { useRpcOverrideStore } from '../stores/useRpcOverrideStore'

function isValidHttpUrl(s: string): boolean {
  try {
    const url = new URL(s)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default function RpcFallbackBanner() {
  const isInternalRpcDown = useRpcOverrideStore((s) => s.isInternalRpcDown)
  const setOverride = useRpcOverrideStore((s) => s.setOverride)
  const setInternalRpcDown = useRpcOverrideStore((s) => s.setInternalRpcDown)

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isInternalRpcDown) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const url = input.trim()
    if (!isValidHttpUrl(url)) {
      setError('Please enter a valid http:// or https:// URL')
      return
    }
    setError(null)
    setOverride('mainnet', url)
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-900/95 text-white border-b border-red-700 px-4 py-3 shadow-lg">
      <div className="max-w-4xl mx-auto flex items-start gap-4">
        <div className="flex-1">
          <div className="font-semibold mb-1">
            Internal RPC providers unavailable
          </div>
          <div className="text-sm text-red-100 mb-2">
            Both primary and backup internal RPC endpoints failed. Paste your
            own mainnet RPC URL below to continue. It will be used only for
            this browser session and stored in sessionStorage.
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="url"
              placeholder="https://your-rpc-provider.example.com/..."
              className="flex-1 px-3 py-2 rounded bg-red-950 border border-red-700 text-white placeholder-red-300 focus:outline-none focus:border-red-400"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-red-700 hover:bg-red-600 text-white font-medium"
            >
              Use this URL
            </button>
          </form>
          {error && <div className="text-sm text-red-200 mt-2">{error}</div>}
        </div>
        <button
          onClick={() => setInternalRpcDown(false)}
          aria-label="Dismiss"
          className="text-red-200 hover:text-white text-2xl leading-none font-bold"
        >
          ×
        </button>
      </div>
    </div>
  )
}
