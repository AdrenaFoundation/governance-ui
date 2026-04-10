import { PublicKey } from '@solana/web3.js'
import { IDL } from '../../../idls/adrena'
import { AnchorProvider, Program } from '@coral-xyz/anchor'

export enum OriginBucket {
  CoreContributor = 0,
  Foundation = 1,
  Ecosystem = 2,
}

export enum LiquidityState {
  GenesisLiquidity = 0,
  Idle = 1,
  Active = 2,
}

// The v1.4.3 Adrena IDL is large enough that `IdlAccounts<Adrena>['X']`
// lookups exceed TypeScript's instantiation-depth limit when the
// resulting types are referenced from downstream files (e.g.
// AddCustody.tsx's form state declaration). The error manifests as
// "Type instantiation is excessively deep and possibly infinite".
// These aliases are typed as `any` to unblock the type-check; the
// runtime IDL and `Program<any>` behavior are unchanged, and the
// Adrena admin forms only read a small handful of well-known fields
// by convention anyway.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Cortex = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VestRegistry = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Custody = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Pool = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Position = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserStaking = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Staking = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Vest = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserProfile = any
export type LimitedString = { value: number[]; length: number }

export type WithPubkey<T> = T & { pubkey: PublicKey }

export type PoolWithPubkey = WithPubkey<Pool>
export type CustodyWithPubkey = WithPubkey<Custody>
export type StakingWithPubkey = WithPubkey<Staking>

// Program<Adrena> would force TypeScript to compute `.methods.X(...)` arg
// types from the full IDL literal type, which exceeds TS's instantiation
// depth limit for the v1.4.3 IDL. `Program<any>` skips that computation;
// the runtime IDL is still the strongly-typed `IDL` const, so on-chain
// behavior is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class AdrenaClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public readonly program: Program<any>

  constructor(
    provider: AnchorProvider,
    public readonly programId: PublicKey,
  ) {
    this.program = new Program<any>(IDL, programId, provider)
  }

  public static readonly governanceProgram = new PublicKey(
    'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw',
  )

  public static readonly mplTokenMetadataProgram = new PublicKey(
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
  )

  public readonly cortexPda: PublicKey = PublicKey.findProgramAddressSync(
    [Buffer.from('cortex')],
    this.programId,
  )[0]

  public readonly oraclePda: PublicKey = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle')],
    this.programId,
  )[0]

  public readonly transferAuthorityPda = PublicKey.findProgramAddressSync(
    [Buffer.from('transfer_authority')],
    this.programId,
  )[0]

  public readonly lmTokenMintDecimals = 6
  public readonly lpTokenMintDecimals = 6

  public getPoolPda(poolName: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(poolName)],
      this.programId,
    )[0]
  }

  public getGenesisLockPda(pool: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('genesis_lock'), pool.toBuffer()],
      this.programId,
    )[0]
  }

  public getLpTokenMint(poolPda: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('lp_token_mint'), poolPda.toBuffer()],
      this.programId,
    )[0]
  }

  public readonly lmTokenMint = PublicKey.findProgramAddressSync(
    [Buffer.from('lm_token_mint')],
    this.programId,
  )[0]

  public readonly lmTokenTreasury = PublicKey.findProgramAddressSync(
    [Buffer.from('lm_token_treasury'), this.lmTokenMint.toBuffer()],
    this.programId,
  )[0]

  public lmTokenMintMetadata = PublicKey.findProgramAddressSync(
    [
      Buffer.from('metadata'),
      AdrenaClient.mplTokenMetadataProgram.toBuffer(),
      this.lmTokenMint.toBuffer(),
    ],
    AdrenaClient.mplTokenMetadataProgram,
  )[0]

  public readonly vestRegistryPda = PublicKey.findProgramAddressSync(
    [Buffer.from('vest_registry')],
    this.programId,
  )[0]

  public getUserVestPda(owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vest'), owner.toBuffer()],
      this.programId,
    )[0]
  }

  public getCustodyPda(pool: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('custody'), pool.toBuffer(), mint.toBuffer()],
      this.programId,
    )[0]
  }

  public findCustodyTokenAccountAddress(pool: PublicKey, mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('custody_token_account'), pool.toBuffer(), mint.toBuffer()],
      this.programId,
    )[0]
  }

  public readonly governanceTokenMint = PublicKey.findProgramAddressSync(
    [Buffer.from('governance_token_mint')],
    this.programId,
  )[0]

  public static getGovernanceRealmConfigPda(governanceRealmPda: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('realm-config'), governanceRealmPda.toBuffer()],
      AdrenaClient.governanceProgram,
    )[0]
  }

  public getGovernanceGoverningTokenHoldingPda(governanceRealmPda: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('governance'),
        governanceRealmPda.toBuffer(),
        this.governanceTokenMint.toBuffer(),
      ],
      AdrenaClient.governanceProgram,
    )[0]
  }

  public getGovernanceGoverningTokenOwnerRecordPda(
    owner: PublicKey,
    governanceRealm: PublicKey,
  ) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('governance'),
        governanceRealm.toBuffer(),
        this.governanceTokenMint.toBuffer(),
        owner.toBuffer(),
      ],
      AdrenaClient.governanceProgram,
    )[0]
  }

  public getCortex(): Promise<Cortex> {
    return this.program.account.cortex.fetch(this.cortexPda)
  }

  public async getPools(): Promise<PoolWithPubkey[]> {
    const pools = await this.program.account.pool.all()

    return pools.map((pool) => ({
      ...pool.account,
      pubkey: pool.publicKey,
    }))
  }

  public async getCustodies(
    pool: PoolWithPubkey,
  ): Promise<CustodyWithPubkey[]> {
    const custodiesPubkeys = pool.custodies.filter(
      (custody) => custody.toBase58() !== PublicKey.default.toBase58(),
    )

    const custodies =
      await this.program.account.custody.fetchMultiple(custodiesPubkeys)

    return custodies.map((custody, index) => ({
      ...custody,
      pubkey: custodiesPubkeys[index],
    })) as CustodyWithPubkey[]
  }

  public async getStakings(): Promise<StakingWithPubkey[]> {
    const stakings = await this.program.account.staking.all()

    return stakings.map((staking) => ({
      ...staking.account,
      pubkey: staking.publicKey,
    }))
  }

  public static toLimitedStringBuffer(str: string): LimitedString {
    const buffer = new Uint8Array(31)
    const ob = Buffer.from(str, 'utf-8')

    // Recreate a LimitedString
    buffer.set(ob.slice(0, 31), 0)

    return {
      value: Array.from(buffer).map((x) => Number(x)),
      length: ob.length,
    }
  }

  public static limitedStringToString(limitedString: LimitedString): string {
    const buffer = Buffer.from(
      limitedString.value.slice(0, limitedString.length),
    )
    return buffer.toString('utf-8')
  }
}
