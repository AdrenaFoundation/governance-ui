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
import { PublicKey, SystemProgram } from '@solana/web3.js'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import { cons } from 'fp-ts/lib/ReadonlyNonEmptyArray'

export interface SetVestDelegateForm {
  governedAccount: AssetAccount | null
  owner: string
  delegate: string
}

export default function SetVestDelegate({
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

  const [form, setForm] = useState<SetVestDelegateForm>({
    governedAccount: null,
    owner: '',
    delegate: '',
  })
  const [formErrors, setFormErrors] = useState({})

  const { handleSetInstructions } = useContext(NewProposalContext)

  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)

    setFormErrors(validationErrors)

    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    const governance = form.governedAccount?.governance

    if (!isValid || !governance || !adrenaClient || !form.owner || !wallet?.publicKey) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const owner = new PublicKey(form.owner);

    const vest = adrenaClient.getUserVestPda(owner);

    console.log('Delegate:', form.delegate === '' ? null: new PublicKey(form.delegate).toBase58())
    console.log('Owner:', owner.toBase58())
    console.log('Vest:', vest.toBase58())
    console.log('Payer:', wallet.publicKey)
    console.log('Cortex:', adrenaClient.cortexPda.toBase58())
    console.log('Caller:', governance.nativeTreasuryAddress.toBase58())

    const instruction = await adrenaClient.program.methods
      .setVestDelegate({
        delegate: form.delegate === '' ? null: new PublicKey(form.delegate),
      })
      .accountsStrict({
        cortex: adrenaClient.cortexPda,
        vest,
        caller: governance.nativeTreasuryAddress,
        owner,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
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
  }, [form])

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
      owner: yup.string().required('Owner is required'),
    })

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
      label: 'Delegate',
      initialValue: form.delegate,
      type: InstructionInputType.INPUT,
      inputType: 'text',
      name: 'delegate',
    },
  ]

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
