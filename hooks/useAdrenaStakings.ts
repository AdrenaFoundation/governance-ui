import { useEffect, useState } from 'react'

import AdrenaClient, { StakingWithPubkey } from '@tools/sdk/adrena/Adrena'

export default function useAdrenaStakings(adrenaClient: AdrenaClient | null) {
  const [stakings, setStakings] = useState<StakingWithPubkey[] | null>(null)

  useEffect(() => {
    ;(async () => {
      if (!adrenaClient) return setStakings(null)

      setStakings(await adrenaClient.getStakings())
    })()
  }, [adrenaClient])

  return stakings
}
