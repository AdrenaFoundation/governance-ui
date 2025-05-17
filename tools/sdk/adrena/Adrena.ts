import { PublicKey } from '@solana/web3.js'
import { IDL, Adrena } from '../../../idls/adrena'
import { AnchorProvider, IdlAccounts, IdlTypes, Program } from '@coral-xyz/anchor'

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

type Accounts = IdlAccounts<Adrena>
type Params = IdlTypes<Adrena>;

export type Cortex = Accounts['cortex']
export type VestRegistry = Accounts['vestRegistry']
export type Custody = Accounts['custody']
export type Pool = Accounts['pool']
export type Position = Accounts['position']
export type UserStaking = Accounts['userStaking']
export type Staking = Accounts['staking']
export type Vest = Accounts['vest']
export type UserProfile = Accounts['userProfile']
export type LimitedString = Params['LimitedString'];

export type WithPubkey<T> = T & { pubkey: PublicKey }

export type PoolWithPubkey = WithPubkey<Pool>
export type CustodyWithPubkey = WithPubkey<Custody>
export type StakingWithPubkey = WithPubkey<Staking>

export default class AdrenaClient {
  public readonly program: Program<Adrena>

  constructor(provider: AnchorProvider, public readonly programId: PublicKey) {
    this.program = new Program<Adrena>(IDL, programId, provider)
  }

  public static readonly governanceProgram = new PublicKey(
    'GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw'
  )

  public readonly cortexPda: PublicKey = PublicKey.findProgramAddressSync(
    [Buffer.from('cortex')],
    this.programId
  )[0]

  public readonly oraclePda: PublicKey = PublicKey.findProgramAddressSync(
    [Buffer.from('oracle')],
    this.programId
  )[0]

  public readonly transferAuthorityPda = PublicKey.findProgramAddressSync(
    [Buffer.from('transfer_authority')],
    this.programId
  )[0]

  public readonly lmTokenMintDecimals = 6
  public readonly lpTokenMintDecimals = 6

  public getPoolPda(poolName: string): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), Buffer.from(poolName)],
      this.programId
    )[0]
  }

  public getGenesisLockPda(pool: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('genesis_lock'), pool.toBuffer()],
      this.programId
    )[0]
  }

  public getLpTokenMint(poolPda: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('lp_token_mint'), poolPda.toBuffer()],
      this.programId
    )[0]
  }

  public readonly lmTokenMint = PublicKey.findProgramAddressSync(
    [Buffer.from('lm_token_mint')],
    this.programId
  )[0]

  public readonly vestRegistryPda = PublicKey.findProgramAddressSync(
    [Buffer.from('vest_registry')],
    this.programId
  )[0]

  public getUserVestPda(owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vest'), owner.toBuffer()],
      this.programId
    )[0]
  }

  public getCustodyPda(pool: PublicKey, mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('custody'), pool.toBuffer(), mint.toBuffer()],
      this.programId
    )[0]
  }

  public findCustodyTokenAccountAddress(pool: PublicKey, mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('custody_token_account'), pool.toBuffer(), mint.toBuffer()],
      this.programId
    )[0]
  }

  public readonly governanceTokenMint = PublicKey.findProgramAddressSync(
    [Buffer.from('governance_token_mint')],
    this.programId
  )[0]

  public static getGovernanceRealmConfigPda(governanceRealmPda: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('realm-config'), governanceRealmPda.toBuffer()],
      AdrenaClient.governanceProgram
    )[0]
  }

  public getGovernanceGoverningTokenHoldingPda(governanceRealmPda: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('governance'),
        governanceRealmPda.toBuffer(),
        this.governanceTokenMint.toBuffer(),
      ],
      AdrenaClient.governanceProgram
    )[0]
  }

  public getGovernanceGoverningTokenOwnerRecordPda(
    owner: PublicKey,
    governanceRealm: PublicKey
  ) {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('governance'),
        governanceRealm.toBuffer(),
        this.governanceTokenMint.toBuffer(),
        owner.toBuffer(),
      ],
      AdrenaClient.governanceProgram
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
    pool: PoolWithPubkey
  ): Promise<CustodyWithPubkey[]> {
    const custodiesPubkeys = pool.custodies.filter(
      (custody) => custody.toBase58() !== PublicKey.default.toBase58()
    )

    const custodies = await this.program.account.custody.fetchMultiple(
      custodiesPubkeys
    )

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

  public toLimitedStringBuffer(str: string): LimitedString {
    const buffer = new Uint8Array(31);
    const ob = Buffer.from(str, 'utf-8');

    // Recreate a LimitedString
    buffer.set(ob.slice(0, 31), 0);

    return {
      value: Array.from(buffer).map(x => Number(x)),
      length: ob.length,
    };
  }
}
