import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { BN } from '@coral-xyz/anchor'
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Governance, ProgramAccount, serializeInstructionToBase64 } from '@solana/spl-governance'

import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { NewProposalContext } from '../../../new'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import { getMintNaturalAmountFromDecimalAsBN } from '@tools/sdk/units'
import { OriginBucket } from '@tools/sdk/adrena/Adrena'
import useAdrenaClient from '@hooks/useAdrenaClient'

export const ORIGIN_BUCKET_VALUES = [
  { name: 'Core Contributor', value: OriginBucket.CoreContributor },
  { name: 'Foundation', value: OriginBucket.Foundation },
  { name: 'Ecosystem', value: OriginBucket.Ecosystem },
]

export interface AddVestForm {
  governedAccount: AssetAccount | null
  owner: string
  amount: number
  originBucket: { name: string; value: OriginBucket }
  unlockStartTimestamp: number
  unlockEndTimestamp: number
  voteMultiplier: number // e.g. 1.0 .. 4.0
}

export default function AddVest({
                                  index,
                                  governance,
                                }: {
  index: number
  governance: ProgramAccount<Governance> | null
}) {
  const wallet = useWalletOnePointOh()
  const { assetAccounts } = useGovernanceAssets()
  const shouldBeGoverned = !!(index !== 0 && governance)

  const programGovernances = assetAccounts.filter(
    (x) => x.type === AccountType.PROGRAM
  )

  const [form, setForm] = useState<AddVestForm>({
    governedAccount: null,
    owner: '',
    amount: 0,
    originBucket: ORIGIN_BUCKET_VALUES[2], // Ecosystem default
    unlockStartTimestamp: 0,
    unlockEndTimestamp: 0,
    voteMultiplier: 1,
  })
  const [formErrors, setFormErrors] = useState({})

  const { handleSetInstructions } = useContext(NewProposalContext)
  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
    owner: yup.string().required('Owner is required'),
    amount: yup.number().moreThan(0, 'Amount must be > 0').required(),
    unlockStartTimestamp: yup.number().required('Unlock start timestamp is required'),
    unlockEndTimestamp: yup
      .number()
      .moreThan(yup.ref('unlockStartTimestamp'), 'End must be > start')
      .required('Unlock end timestamp is required'),
    voteMultiplier: yup.number().moreThan(0, 'Vote multiplier must be > 0').required(),
  })

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)
    setFormErrors(validationErrors)
    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    const gov = form.governedAccount?.governance

    if (!isValid || !gov || !adrenaClient || !wallet?.publicKey) {
      return {
        serializedInstruction: '',
        isValid,
        governance: gov,
        chunkBy: 1,
      }
    }

    const owner = new PublicKey(form.owner)

    const instruction = await adrenaClient.program.methods
      .addVest({
        amount: getMintNaturalAmountFromDecimalAsBN(
          form.amount,
          adrenaClient.lmTokenMintDecimals
        ),
        originBucket: form.originBucket.value,
        unlockStartTimestamp: new BN(form.unlockStartTimestamp),
        unlockEndTimestamp: new BN(form.unlockEndTimestamp),
        // program expects multiplier scaled by 10_000 (e.g. 1.5x => 15000)
        voteMultiplier: Math.floor(form.voteMultiplier * 10_000),
      })
      .accountsStrict({
        admin: gov.nativeTreasuryAddress,
        owner,
        payer: wallet.publicKey,
        transferAuthority: adrenaClient.transferAuthorityPda,
        cortex: adrenaClient.cortexPda,
        vestRegistry: adrenaClient.vestRegistryPda,
        vest: adrenaClient.getUserVestPda(owner),
        lmTokenMint: adrenaClient.lmTokenMint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction()

    return {
      serializedInstruction: serializeInstructionToBase64(instruction),
      isValid,
      governance: gov,
      chunkBy: 1,
    }
  }

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  const inputs: InstructionInput[] = [
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
      label: 'Owner',
      initialValue: form.owner,
      type: InstructionInputType.INPUT,
      inputType: 'text',
      name: 'owner',
    },
    {
      label: 'Origin Bucket',
      initialValue: form.originBucket,
      type: InstructionInputType.SELECT,
      name: 'originBucket',
      options: ORIGIN_BUCKET_VALUES,
    },
    {
      label: 'Token Amount',
      initialValue: form.amount,
      type: InstructionInputType.INPUT,
      inputType: 'number',
      name: 'amount',
    },
    {
      label: 'Unlock Start Timestamp (unix seconds)',
      initialValue: form.unlockStartTimestamp,
      type: InstructionInputType.INPUT,
      inputType: 'number',
      name: 'unlockStartTimestamp',
    },
    {
      label: 'Unlock End Timestamp (unix seconds)',
      initialValue: form.unlockEndTimestamp,
      type: InstructionInputType.INPUT,
      inputType: 'number',
      name: 'unlockEndTimestamp',
    },
    {
      label: 'Vote Multiplier (e.g. 1.0 - 4.0)',
      initialValue: form.voteMultiplier,
      type: InstructionInputType.INPUT,
      inputType: 'number',
      name: 'voteMultiplier',
    },
  ]

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
