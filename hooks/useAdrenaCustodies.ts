import { useEffect, useState } from 'react'

import AdrenaClient, {
  CustodyWithPubkey,
  PoolWithPubkey,
} from '@tools/sdk/adrena/Adrena'

export default function useAdrenaCustodies(
  adrenaClient: AdrenaClient | null,
  pool: PoolWithPubkey | null
) {
  const [custodies, setCustodies] = useState<CustodyWithPubkey[] | null>(null)

  useEffect(() => {
    ;(async () => {
      if (adrenaClient === null || pool === null) {
        return setCustodies(null)
      }

      setCustodies(await adrenaClient.getCustodies(pool))
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!adrenaClient, pool?.name ?? null])

  return custodies
}
