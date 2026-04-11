import { useEffect, useState } from 'react'
import { PublicKey } from '@solana/web3.js'

import { useConnection } from '@solana/wallet-adapter-react'
import { AnchorProvider, Wallet } from '@coral-xyz/anchor'
import useWalletOnePointOh from './useWalletOnePointOh'
import AdrenaClient from '@tools/sdk/adrena/Adrena'

export default function useAdrenaClient(
  programId: PublicKey | null
): AdrenaClient | null {
  const { connection } = useConnection()
  const wallet = useWalletOnePointOh()
  const [adrenaClient, setAdrenaClient] = useState<AdrenaClient | null>(null)

  useEffect(() => {
    if (!programId) return setAdrenaClient(null)

    setAdrenaClient(
      new AdrenaClient(
        // The wallet type is compatible with the anchor provider, force typing
        new AnchorProvider(connection, (wallet as unknown) as Wallet, {
          commitment: 'processed',
          skipPreflight: true,
        }),
        programId
      )
    )
  }, [connection, wallet, programId])

  return adrenaClient
}
