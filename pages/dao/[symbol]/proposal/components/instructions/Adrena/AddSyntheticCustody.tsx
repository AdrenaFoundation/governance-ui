import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { Governance } from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import { NewProposalContext } from '../../../new'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import useAdrenaClient from '@hooks/useAdrenaClient'
import { BN } from '@coral-xyz/anchor'
import AdrenaClient, { PoolWithPubkey } from '@tools/sdk/adrena/Adrena'
import useAdrenaPools from '@hooks/useAdrenaPools'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@realms-today/spl-governance'

// Trade oracle feed IDs for Autonom synthetic assets (adrena-abi autonom.mainnet.json)
const TRADE_ORACLE_OPTIONS = [
  { name: 'XAU (Gold) — feed_id 36', value: 36 },
  { name: 'XAG (Silver) — feed_id 37', value: 37 },
  { name: 'WTI (Crude Oil) — feed_id 38', value: 38 },
  { name: 'XBR (Brent Crude) — feed_id 39', value: 39 },
]

export interface AddSyntheticCustodyForm {
  governedAccount: AssetAccount | null
  pool: {
    name: string
    value: PoolWithPubkey
  } | null
  seedString: string
  tradeOracleFeedId: number
  maxInitialLeverage: number
  maxLeverage: number
  maxPositionLockedUsd: number
  maxCumulativeShortPositionSizeUsd: number
  maxCumulativeLongPositionSizeUsd: number
  feeSwapIn: number
  feeSwapOut: number
  feeStableSwapIn: number
  feeStableSwapOut: number
  feeAddLiquidity: number
  feeRemoveLiquidity: number
  feeClosePosition: number
  feeLiquidation: number
  feeMax: number
  maxHourlyBorrowInterestRate: number
}

export default function AddSyntheticCustody({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) {
  const { assetAccounts } = useGovernanceAssets()
  const shouldBeGoverned = !!(index !== 0 && governance)
  const wallet = useWalletOnePointOh()

  const programGovernances = assetAccounts.filter(
    (x) => x.type === AccountType.PROGRAM
  )

  const [form, setForm] = useState<AddSyntheticCustodyForm>({
    governedAccount: null,
    pool: null,
    seedString: '',
    tradeOracleFeedId: 36,
    maxInitialLeverage: 1_050_000, // x105
    maxLeverage: 1_100_000, // x110
    maxPositionLockedUsd: 250_000,
    maxCumulativeShortPositionSizeUsd: 1_000_000,
    maxCumulativeLongPositionSizeUsd: 1_000_000,
    feeSwapIn: 0,
    feeSwapOut: 0,
    feeStableSwapIn: 0,
    feeStableSwapOut: 0,
    feeAddLiquidity: 0,
    feeRemoveLiquidity: 0,
    feeClosePosition: 16,
    feeLiquidation: 16,
    feeMax: 200,
    maxHourlyBorrowInterestRate: 80000, // 0.008%
  })
  const [formErrors, setFormErrors] = useState({})

  const { handleSetInstructions } = useContext(NewProposalContext)

  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  const pools = useAdrenaPools(adrenaClient)

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)
    setFormErrors(validationErrors)
    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    const governance = form.governedAccount?.governance

    if (
      !isValid ||
      !governance ||
      !adrenaClient ||
      !form.pool ||
      !wallet?.publicKey ||
      !form.seedString
    ) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    // Encode seed string as 32-byte zero-padded UTF-8 buffer
    const seedBytes = Array.from(
      Buffer.concat([
        Buffer.from(form.seedString, 'utf8').slice(0, 32),
        Buffer.alloc(32),
      ]).slice(0, 32)
    )

    const custodyPda = adrenaClient.getSyntheticCustodyPda(
      form.pool.value.pubkey,
      seedBytes
    )

    const instruction = await adrenaClient.program.methods
      .addSyntheticCustody({
        pricing: {
          maxInitialLeverage: form.maxInitialLeverage,
          maxLeverage: form.maxLeverage,
          maxPositionLockedUsd: new BN(form.maxPositionLockedUsd * 10 ** 6),
          maxCumulativeShortPositionSizeUsd: new BN(
            form.maxCumulativeShortPositionSizeUsd * 10 ** 6
          ),
          maxCumulativeLongPositionSizeUsd: new BN(
            form.maxCumulativeLongPositionSizeUsd * 10 ** 6
          ),
        },
        allowSwap: false,
        allowTrade: true,
        fees: {
          swapIn: form.feeSwapIn,
          swapOut: form.feeSwapOut,
          stableSwapIn: form.feeStableSwapIn,
          stableSwapOut: form.feeStableSwapOut,
          addLiquidity: form.feeAddLiquidity,
          removeLiquidity: form.feeRemoveLiquidity,
          closePosition: form.feeClosePosition,
          liquidation: form.feeLiquidation,
          feeMax: form.feeMax,
          padding: [0, 0, 0, 0, 0, 0],
          padding2: new BN(0),
        },
        borrowRate: {
          maxHourlyBorrowInterestRate: new BN(form.maxHourlyBorrowInterestRate),
        },
        tradeOracle: AdrenaClient.toLimitedStringBuffer('autonom'),
        tradeOracleFeedId: form.tradeOracleFeedId,
        seed: seedBytes,
      })
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        payer: governance.nativeTreasuryAddress,
        transferAuthority: adrenaClient.transferAuthorityPda,
        cortex: adrenaClient.cortexPda,
        pool: form.pool.value.pubkey,
        custody: custodyPda,
        oracle: adrenaClient.oraclePda,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()

    return {
      serializedInstruction: serializeInstructionToBase64(instruction),
      isValid,
      governance,
      chunkBy: 1,
    }
  }

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, !!pools])

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
    seedString: yup.string().required('Seed string is required').max(32),
  })

  const [inputs, setInputs] = useState<InstructionInput[]>([])

  useEffect(() => {
    const base = [
      {
        label: 'Governance',
        initialValue: form.governedAccount,
        name: 'governedAccount',
        type: InstructionInputType.GOVERNED_ACCOUNT,
        shouldBeGoverned: shouldBeGoverned as any,
        governance,
        options: programGovernances,
      },
      {
        label: 'Pool',
        initialValue: form.pool,
        type: InstructionInputType.SELECT,
        name: 'pool',
        options:
          pools?.map((p) => ({
            name: String.fromCharCode(...p.name.value),
            value: p,
          })) ?? [],
      },
    ]

    if (!form.pool) {
      return setInputs(base)
    }

    setInputs([
      ...base,
      {
        label: 'Seed String (≤32 chars, identifies this synthetic custody)',
        initialValue: form.seedString,
        type: InstructionInputType.INPUT,
        name: 'seedString',
        inputType: 'string',
      },
      {
        label: 'Trade Oracle Feed ID',
        initialValue: form.tradeOracleFeedId,
        type: InstructionInputType.SELECT,
        name: 'tradeOracleFeedId',
        options: TRADE_ORACLE_OPTIONS,
      },
      {
        label: 'Max Initial Leverage (10000 = x1)',
        initialValue: 1_050_000, // x105
        type: InstructionInputType.INPUT,
        name: 'maxInitialLeverage',
        inputType: 'number',
      },
      {
        label: 'Max Leverage (10000 = x1)',
        initialValue: 1_100_000, // x110
        type: InstructionInputType.INPUT,
        name: 'maxLeverage',
        inputType: 'number',
      },
      {
        label: 'Max Position Locked Usd',
        initialValue: 250_000,
        type: InstructionInputType.INPUT,
        name: 'maxPositionLockedUsd',
        inputType: 'number',
      },
      {
        label: 'Max Cumulative Short Position Size Usd',
        initialValue: 1_000_000,
        type: InstructionInputType.INPUT,
        name: 'maxCumulativeShortPositionSizeUsd',
        inputType: 'number',
      },
      {
        label: 'Max Cumulative Long Position Size Usd',
        initialValue: 1_000_000,
        type: InstructionInputType.INPUT,
        name: 'maxCumulativeLongPositionSizeUsd',
        inputType: 'number',
      },
      {
        label: 'Fee Close Position (in BPS)',
        initialValue: 16,
        type: InstructionInputType.INPUT,
        name: 'feeClosePosition',
        inputType: 'number',
      },
      {
        label: 'Fee Liquidation (in BPS)',
        initialValue: 16,
        type: InstructionInputType.INPUT,
        name: 'feeLiquidation',
        inputType: 'number',
      },
      {
        label: 'Fee Max (in BPS)',
        initialValue: 200,
        type: InstructionInputType.INPUT,
        name: 'feeMax',
        inputType: 'number',
      },
      {
        label: 'Max Hourly Borrow Interest Rate (0.008% = 80000)',
        initialValue: 80000,
        type: InstructionInputType.INPUT,
        name: 'maxHourlyBorrowInterestRate',
        inputType: 'number',
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    form.pool?.name ?? 'none',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    !!governance,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    !!pools,
    programGovernances,
    shouldBeGoverned,
  ])

  if (!form) return <></>

  return (
    <InstructionForm
      outerForm={form}
      setForm={setForm}
      inputs={inputs}
      setFormErrors={setFormErrors}
      formErrors={formErrors}
    />
  )
}
