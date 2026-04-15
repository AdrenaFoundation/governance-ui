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
import { PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import AdrenaClient, { CustodyWithPubkey, PoolWithPubkey } from '@tools/sdk/adrena/Adrena'
import useAdrenaPools from '@hooks/useAdrenaPools'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import useAdrenaCustodies from '@hooks/useAdrenaCustodies'

export interface AddCustodyForm {
  governedAccount: AssetAccount | null
  pool: {
    name: string
    value: PoolWithPubkey
  } | null
  custody: { name: string; value: CustodyWithPubkey } | null
  custodyOracle: string | null
  custodyTradeOracle: string | null
  isStable: boolean
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
  maxHourlyFundingRate: number
  minTotalOiUsd: number
  imbalanceSensitivityBps: number
}

export default function AddCustody({
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

  const [form, setForm] = useState<AddCustodyForm>({
    governedAccount: null,
    pool: null,
    custody: null,
    custodyOracle: null,
    custodyTradeOracle: null,
    isStable: false,
    maxInitialLeverage: 1_050_000, // x105
    maxLeverage: 1_100_000, // x110
    maxPositionLockedUsd: 250_000,
    maxCumulativeShortPositionSizeUsd: 1_000_000,
    maxCumulativeLongPositionSizeUsd: 1_000_000,
    feeSwapIn: 10,
    feeSwapOut: 10,
    feeStableSwapIn: 10,
    feeStableSwapOut: 10,
    feeAddLiquidity: 10,
    feeRemoveLiquidity: 10,
    feeClosePosition: 16,
    feeLiquidation: 16,
    feeMax: 200,
    maxHourlyBorrowInterestRate: 80000, // 0.008%
    maxHourlyFundingRate: 0,
    minTotalOiUsd: 0,
    imbalanceSensitivityBps: 0,
  })
  const [formErrors, setFormErrors] = useState({})

  const { handleSetInstructions } = useContext(NewProposalContext)

  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  const pools = useAdrenaPools(adrenaClient)

  const custodies = useAdrenaCustodies(adrenaClient, form.pool?.value ?? null)

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
      !form.custodyOracle ||
      !form.custodyTradeOracle ||
      !custodies ||
      !form.custody
    ) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const instruction = await adrenaClient.program.methods
      .setCustodyConfig({
        isStable: form.isStable,
        oracle: AdrenaClient.toLimitedStringBuffer(form.custodyOracle),
        tradeOracle: AdrenaClient.toLimitedStringBuffer(form.custodyTradeOracle),
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
        virtualFunding: {
          maxHourlyFundingRate: new BN(form.maxHourlyFundingRate),
          minTotalOiUsd: new BN(form.minTotalOiUsd * 10 ** 6),
          imbalanceSensitivityBps: form.imbalanceSensitivityBps,
          padding: [0, 0, 0, 0, 0, 0],
        },
        ratios: Array.from(Array(8)).map((_, i) => ({
          min: form[`ratio${i + 1}Min`] as number,
          target: form[`ratio${i + 1}Target`] as number,
          max: form[`ratio${i + 1}Max`] as number,
          padding: [0, 0],
        })),
      })
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        cortex: adrenaClient.cortexPda,
        custody: form.custody.value.pubkey,
        pool: form.pool.value.pubkey,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [form, !!pools, !!custodies])

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
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
      {
        label: 'Custody',
        initialValue: form.custody,
        type: InstructionInputType.SELECT,
        name: 'custody',
        options:
          custodies?.map((c) => ({
            name: c.pubkey.toBase58(),
            value: c,
          })) ?? [],
      },
    ]

    const pool = form.pool?.value
    const custody = form.custody?.value

    if (!pool || !custody || !custodies) {
      return setInputs(base)
    }

    setInputs([
      ...base,
      {
        label: 'Custody Oracle',
        initialValue: AdrenaClient.limitedStringToString(custody.oracle),
        type: InstructionInputType.INPUT,
        name: 'custodyOracle',
        inputType: 'string',
      },
      {
        label: 'Custody Trade Oracle',
        initialValue: AdrenaClient.limitedStringToString(custody.tradeOracle),
        type: InstructionInputType.INPUT,
        name: 'custodyTradeOracle',
        inputType: 'string',
      },
      {
        label: 'Is Stable',
        initialValue: custody.isStable,
        type: InstructionInputType.SWITCH,
        name: 'isStable',
      },
      {
        label: 'Max Initial Leverage (10000 = x1)',
        initialValue: custody.pricing.maxInitialLeverage,
        type: InstructionInputType.INPUT,
        name: 'maxInitialLeverage',
        inputType: 'number',
      },
      {
        label: 'Max Leverage (10000 = x1)',
        initialValue: custody.pricing.maxLeverage,
        type: InstructionInputType.INPUT,
        name: 'maxLeverage',
        inputType: 'number',
      },
      {
        label: 'Max Position Locked Usd',
        initialValue: custody.pricing.maxPositionLockedUsd.toNumber() / 10 ** 6,
        type: InstructionInputType.INPUT,
        name: 'maxPositionLockedUsd',
        inputType: 'number',
      },
      {
        label: 'Max Cumulative Short Position Size Usd',
        initialValue:
          custody.pricing.maxCumulativeShortPositionSizeUsd.toNumber() /
          10 ** 6,
        type: InstructionInputType.INPUT,
        name: 'maxCumulativeShortPositionSizeUsd',
        inputType: 'number',
      },
      {
        label: 'Max Cumulative Long Position Size Usd',
        initialValue:
          custody.pricing.maxCumulativeLongPositionSizeUsd.toNumber() /
          10 ** 6,
        type: InstructionInputType.INPUT,
        name: 'maxCumulativeLongPositionSizeUsd',
        inputType: 'number',
      },
      {
        label: 'Fee Swap IN (in BPS)',
        initialValue: custody.fees.swapIn,
        type: InstructionInputType.INPUT,
        name: 'feeSwapIn',
        inputType: 'number',
      },
      {
        label: 'Fee Swap OUT (in BPS)',
        initialValue: custody.fees.swapOut,
        type: InstructionInputType.INPUT,
        name: 'feeSwapOut',
        inputType: 'number',
      },
      {
        label: 'Fee Stable Swap IN (in BPS)',
        initialValue: custody.fees.stableSwapIn,
        type: InstructionInputType.INPUT,
        name: 'feeStableSwapIn',
        inputType: 'number',
      },
      {
        label: 'Fee Stable Swap OUT (in BPS)',
        initialValue: custody.fees.stableSwapOut,
        type: InstructionInputType.INPUT,
        name: 'feeStableSwapOut',
        inputType: 'number',
      },
      {
        label: 'Fee Add Liquidity (in BPS)',
        initialValue: custody.fees.addLiquidity,
        type: InstructionInputType.INPUT,
        name: 'feeAddLiquidity',
        inputType: 'number',
      },
      {
        label: 'Fee Remove Liquidity (in BPS)',
        initialValue: custody.fees.removeLiquidity,
        type: InstructionInputType.INPUT,
        name: 'feeRemoveLiquidity',
        inputType: 'number',
      },
      {
        label: 'Fee Close Position (in BPS)',
        initialValue: custody.fees.closePosition,
        type: InstructionInputType.INPUT,
        name: 'feeClosePosition',
        inputType: 'number',
      },
      {
        label: 'Fee Liquidation (in BPS)',
        initialValue: custody.fees.liquidation,
        type: InstructionInputType.INPUT,
        name: 'feeLiquidation',
        inputType: 'number',
      },
      {
        label: 'Fee Max (in BPS)',
        initialValue: custody.fees.feeMax,
        type: InstructionInputType.INPUT,
        name: 'feeMax',
        inputType: 'number',
      },
      {
        label: 'Max Hourly Borrow Interest Rate (0.008% = 80000)',
        initialValue: custody.borrowRate.maxHourlyBorrowInterestRate,
        type: InstructionInputType.INPUT,
        name: 'maxHourlyBorrowInterestRate',
        inputType: 'number',
      },
      {
        label: 'Virtual Funding Max Hourly Rate',
        initialValue: custody.virtualFunding.maxHourlyFundingRate.toNumber(),
        type: InstructionInputType.INPUT,
        name: 'maxHourlyFundingRate',
        inputType: 'number',
      },
      {
        label: 'Virtual Funding Min Total OI Usd',
        initialValue:
          custody.virtualFunding.minTotalOiUsd.toNumber() / 10 ** 6,
        type: InstructionInputType.INPUT,
        name: 'minTotalOiUsd',
        inputType: 'number',
      },
      {
        label: 'Virtual Funding Imbalance Sensitivity BPS',
        initialValue: custody.virtualFunding.imbalanceSensitivityBps,
        type: InstructionInputType.INPUT,
        name: 'imbalanceSensitivityBps',
        inputType: 'number',
      },
      ...(Array.from(Array(custodies?.length))
        .map((_, i) => [
          {
            label: `Custody ${i + 1} Min Ratio (${
              pool.custodies[i].toBase58() == custody.pubkey.toBase58()
                ? '*UPDATE'
                : form.pool!.value.custodies[i].toBase58().slice(0, 4)
            })`,
            initialValue: pool.ratios[i].min,
            type: InstructionInputType.INPUT,
            name: `ratio${i + 1}Min`,
            inputType: 'number',
          },
          {
            label: `Custody ${i + 1} Target Ratio (${
              pool.custodies[i].toBase58() == custody.pubkey.toBase58()
                ? '*UPDATE'
                : form.pool!.value.custodies[i].toBase58().slice(0, 4)
            })`,
            initialValue: pool.ratios[i].target,
            type: InstructionInputType.INPUT,
            name: `ratio${i + 1}Target`,
            inputType: 'number',
          },
          {
            label: `Custody ${i + 1} Max Ratios (${
              pool.custodies[i].toBase58() == custody.pubkey.toBase58()
                ? '*UPDATE'
                : form.pool!.value.custodies[i].toBase58().slice(0, 4)
            })`,
            initialValue: pool.ratios[i].max,
            type: InstructionInputType.INPUT,
            name: `ratio${i + 1}Max`,
            inputType: 'number',
          },
        ])
        .flat() as InstructionInput[]),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    form.pool?.name ?? 'none',
    custodies?.length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    form.custody?.name ?? 'none',
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
