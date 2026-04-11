import { PublicKey } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import queryClient from './queryClient'

// Jupiter retired the `price/v2` endpoint (404 "Route not found"). The
// current endpoint is `price/v3`, which has a different response shape:
//
//   v3: flat dict, { "<mint>": { usdPrice: 84.12, liquidity: ..., ... } }
//   v2: wrapped,   { data: { "<mint>": { id, type, price: "84.12" } }, timeTaken }
//
// Downstream consumers in this file (and its exported functions) were
// written against the v2 shape. Rather than change every consumer, we
// keep the wrapped `Response` interface and remap the v3 payload into
// it at the fetch boundary via `fetchPricesV3`. As a side benefit, v3
// returns usdPrice as a number (v2 returned price as a string), which
// matches the `price: number` type annotation that was previously
// lying about the runtime type.
const URL = 'https://lite-api.jup.ag/price/v3'

type Price = {
  id: string // pubkey,
  // price is in USD
  price: number
}
type Response = {
  data: Record<string, Price> // no entry if data not found
  timeTaken: number
}

type V3Entry = {
  createdAt?: string
  liquidity?: number
  usdPrice?: number
  blockId?: number
  decimals?: number
  priceChange24h?: number
}

async function fetchPricesV3(ids: string[]): Promise<Response> {
  if (ids.length === 0) return { data: {}, timeTaken: 0 }
  const x = await fetch(`${URL}?ids=${ids.join(',')}`)
  const raw = (await x.json()) as Record<string, V3Entry | null | undefined>
  const data: Record<string, Price> = {}
  for (const [mint, entry] of Object.entries(raw)) {
    if (entry && typeof entry.usdPrice === 'number') {
      data[mint] = { id: mint, price: entry.usdPrice }
    }
  }
  return { data, timeTaken: 0 }
}

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n)
  }
}

export const jupiterPriceQueryKeys = {
  all: ['Jupiter Price API'],
  byMint: (mint: PublicKey) => [...jupiterPriceQueryKeys.all, mint.toString()],
  byMints: (mints: PublicKey[]) => [
    ...jupiterPriceQueryKeys.all,
    mints.map((x) => x.toString()).sort(),
  ],
}

const jupQueryFn = async (mint: PublicKey) => {
  const response = await fetchPricesV3([mint.toString()])
  const result = response.data[mint.toString()]
  return result !== undefined
    ? ({ found: true, result } as const)
    : ({ found: false, result: undefined } as const)
}

export const useJupiterPriceByMintQuery = (mint: PublicKey | undefined) => {
  const enabled = mint !== undefined
  return useQuery({
    queryKey: enabled ? jupiterPriceQueryKeys.byMint(mint) : undefined,
    queryFn: async () => {
      if (!enabled) throw new Error()
      return jupQueryFn(mint)
    },
  })
}

export const fetchJupiterPrice = async (mint: PublicKey) =>
  queryClient.fetchQuery({
    queryKey: jupiterPriceQueryKeys.byMint(mint),
    queryFn: () => jupQueryFn(mint),
  })

/**
 * @deprecated
 * do not use this! it only exists to replace a previously existing synchronous function. use fetchJupiterPrice
 * */
export const getJupiterPriceSync = (mint: PublicKey) =>
  ((queryClient.getQueryData(jupiterPriceQueryKeys.byMint(mint)) as any)?.result
    ?.price as number) ?? 0

export const useJupiterPricesByMintsQuery = (mints: PublicKey[]) => {
  const enabled = mints.length > 0
  const deduped = new Set(mints)
  const dedupedMints = Array.from(deduped)

  return useQuery({
    enabled,
    queryKey: jupiterPriceQueryKeys.byMints(dedupedMints),
    queryFn: async () => {
      const batches = [...chunks(dedupedMints, 100)]
      const responses = await Promise.all(
        batches.map((batch) => fetchPricesV3(batch.map((m) => m.toString()))),
      )
      const data = responses.reduce(
        (acc, next) => ({ ...acc, ...next.data }),
        {} as Response['data'],
      )

      //override chai price if its broken
      const chaiMint = '3jsFX1tx2Z8ewmamiwSU851GzyzM2DJMq7KWW5DM8Py3'
      const chaiData = data[chaiMint]

      if (chaiData?.price && (chaiData.price > 1.3 || chaiData.price < 0.9)) {
        data[chaiMint] = {
          ...chaiData,
          price: 1,
        }
      }
      return data
    },
    onSuccess: (data) => {
      dedupedMints.forEach((mint) =>
        queryClient.setQueryData(
          jupiterPriceQueryKeys.byMint(mint),
          data[mint.toString()]
            ? ({ found: true, result: data[mint.toString()] } as const)
            : ({ found: false, result: undefined } as const),
        ),
      )
    },
  })
}

// function is used to get fresh token prices
export const getJupiterPricesByMintStrings = async (mints: string[]) => {
  if (mints.length === 0) return {}
  const deduped = new Set(mints)
  const dedupedMints = Array.from(deduped)
  try {
    const response = await fetchPricesV3(dedupedMints)
    const data = response.data

    //override chai price if its broken
    const chaiMint = '3jsFX1tx2Z8ewmamiwSU851GzyzM2DJMq7KWW5DM8Py3'
    const chaiData = data[chaiMint]

    if (chaiData?.price && (chaiData.price > 1.3 || chaiData.price < 0.9)) {
      data[chaiMint] = {
        ...chaiData,
        price: 1,
      }
    }
    return data
  } catch (error) {
    console.error('Error fetching Jupiter prices:', error)
    throw error
  }
}
