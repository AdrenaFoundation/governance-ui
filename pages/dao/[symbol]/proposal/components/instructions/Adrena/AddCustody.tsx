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
import { PublicKey, SYSVAR_RENT_PUBKEY } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import AdrenaClient, { PoolWithPubkey } from '@tools/sdk/adrena/Adrena'
import useAdrenaPools from '@hooks/useAdrenaPools'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@realms-today/spl-governance'

export interface AddCustodyForm {
  governedAccount: AssetAccount | null
  pool: {
    name: string
    value: PoolWithPubkey
  } | null
  mint: string | null
  custodyOracle: string | null
  custodyTradeOracle: string | null
  isStable: boolean
  maxInitialLeverage: number
  maxLeverage: number
  maxPositionLockedUsd: number
  maxCumulativeShortPositionSizeUsd: number
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
    mint: null,
    custodyOracle: null,
    custodyTradeOracle: null,
    isStable: false,
    maxInitialLeverage: 0,
    maxLeverage: 0,
    maxPositionLockedUsd: 0,
    maxCumulativeShortPositionSizeUsd: 0,
    feeSwapIn: 0,
    feeSwapOut: 0,
    feeStableSwapIn: 0,
    feeStableSwapOut: 0,
    feeAddLiquidity: 0,
    feeRemoveLiquidity: 0,
    feeClosePosition: 0,
    feeLiquidation: 0,
    feeMax: 0,
    maxHourlyBorrowInterestRate: 0,
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
      !form.mint ||
      !form.custodyOracle ||
      !form.custodyTradeOracle
    ) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const mint = new PublicKey(form.mint)

    const custodyPda = adrenaClient.getCustodyPda(form.pool.value.pubkey, mint)
    const custodyTokenAccountPda = adrenaClient.findCustodyTokenAccountAddress(
      form.pool.value.pubkey,
      mint
    )

    const instruction = await adrenaClient.program.methods
      .addCustody({
        isStable: form.isStable,
        pricing: {
          maxInitialLeverage: form.maxInitialLeverage,
          maxLeverage: form.maxLeverage,
          maxPositionLockedUsd: new BN(form.maxPositionLockedUsd * 10 ** 6),
          maxCumulativeShortPositionSizeUsd: new BN(
            form.maxCumulativeShortPositionSizeUsd * 10 ** 6
          ),
        },
        allowSwap: false,
        allowTrade: false,
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
        ratios: Array.from(Array(8)).map((_, i) => ({
          min: form[`ratio${i + 1}Min`] as number,
          target: form[`ratio${i + 1}Target`] as number,
          max: form[`ratio${i + 1}Max`] as number,
          padding: [0, 0],
        })),
        oracle: AdrenaClient.toLimitedStringBuffer(form.custodyOracle),
        tradeOracle: AdrenaClient.toLimitedStringBuffer(form.custodyTradeOracle)
      })
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        cortex: adrenaClient.cortexPda,
        custody: custodyPda,
        pool: form.pool.value.pubkey,
        payer: wallet.publicKey,
        transferAuthority: adrenaClient.transferAuthorityPda,
        custodyTokenAccount: custodyTokenAccountPda,
        oracle: adrenaClient.oraclePda,
        custodyTokenMint: mint,
        systemProgram: SYSTEM_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
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
  }, [form, !!pools])

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
    ]

    const pool = form.pool?.value

    if (!pool) {
      return setInputs(base)
    }

    const newCustodyPosition = pool.custodies.findIndex(
      (x) => x.toBase58() === PublicKey.default.toBase58()
    )

    setInputs([
      ...base,
      {
        label: 'Mint',
        initialValue: form.mint,
        type: InstructionInputType.INPUT,
        name: 'mint',
        inputType: 'string',
      },
      {
        label: 'Custody Oracle',
        initialValue: form.custodyOracle,
        type: InstructionInputType.INPUT,
        name: 'custodyOracle',
        inputType: 'string',
      },
      {
        label: 'Custody Trade Oracle',
        initialValue: form.custodyTradeOracle,
        type: InstructionInputType.INPUT,
        name: 'custodyTradeOracle',
        inputType: 'string',
      },
      {
        label: 'Is Stable',
        initialValue: form.isStable,
        type: InstructionInputType.SWITCH,
        name: 'isStable',
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
        label: 'Fee Swap IN (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeSwapIn',
        inputType: 'number',
      },
      {
        label: 'Fee Swap OUT (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeSwapOut',
        inputType: 'number',
      },
      {
        label: 'Fee Stable Swap IN (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeStableSwapIn',
        inputType: 'number',
      },
      {
        label: 'Fee Stable Swap OUT (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeStableSwapOut',
        inputType: 'number',
      },
      {
        label: 'Fee Add Liquidity (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeAddLiquidity',
        inputType: 'number',
      },
      {
        label: 'Fee Remove Liquidity (in BPS)',
        initialValue: 10,
        type: InstructionInputType.INPUT,
        name: 'feeRemoveLiquidity',
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
        initialValue: 80000, // 0.008%
        type: InstructionInputType.INPUT,
        name: 'maxHourlyBorrowInterestRate',
        inputType: 'number',
      },
      ...(Array.from(Array(newCustodyPosition + 1))
        .map((_, i) => [
          {
            label: `Custody ${i + 1} Min Ratio (${
              i === newCustodyPosition
                ? '*NEW CUSTODY'
                : form.pool!.value.custodies[i].toBase58() !=
                  PublicKey.default.toBase58()
                ? form.pool!.value.custodies[i].toBase58().slice(0, 4)
                : '-'
            })`,
            initialValue: form[`ratio${i + 1}Min`],
            type: InstructionInputType.INPUT,
            name: `ratio${i + 1}Min`,
            inputType: 'number',
          },
          {
            label: `Custody ${i + 1} Target Ratio (${
              i === newCustodyPosition
                ? '*NEW CUSTODY'
                : form.pool!.value.custodies[i].toBase58() !=
                  PublicKey.default.toBase58()
                ? form.pool!.value.custodies[i].toBase58().slice(0, 4)
                : '-'
            })`,
            initialValue: form[`ratio${i + 1}Target`],
            type: InstructionInputType.INPUT,
            name: `ratio${i + 1}Target`,
            inputType: 'number',
          },
          {
            label: `Custody ${i + 1} Max Ratios (${
              i === newCustodyPosition
                ? '*NEW CUSTODY'
                : form.pool!.value.custodies[i].toBase58() !=
                  PublicKey.default.toBase58()
                ? form.pool!.value.custodies[i].toBase58().slice(0, 4)
                : '-'
            })`,
            initialValue: form[`ratio${i + 1}Max`],
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
