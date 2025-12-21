import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import {
  Governance,
  ProgramAccount,
  serializeInstructionToBase64,
} from '@solana/spl-governance'

import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { NewProposalContext } from '../../../new'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import useAdrenaClient from '@hooks/useAdrenaClient'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'

export interface CancelVestForm {
  governedAccount: AssetAccount | null
  owner: string
}

export default function CancelVest({
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

  const [form, setForm] = useState<CancelVestForm>({
    governedAccount: null,
    owner: '',
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
  })

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)
    setFormErrors(validationErrors)
    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    const gov = form.governedAccount?.governance

    if (
      !isValid ||
      !gov ||
      !adrenaClient ||
      !wallet?.publicKey ||
      !form.owner
    ) {
      return {
        serializedInstruction: '',
        isValid,
        governance: gov,
        chunkBy: 1,
      }
    }

    const owner = new PublicKey(form.owner)
    const vest = adrenaClient.getUserVestPda(owner)

    // Matches your cancel_vest.rs accounts:
    // admin, owner, payer, cortex, vest_registry, vest, system_program
    const instruction = await adrenaClient.program.methods
      .cancelVest()
      .accountsStrict({
        admin: gov.nativeTreasuryAddress,
        owner,
        payer: wallet.publicKey,
        cortex: adrenaClient.cortexPda,
        vestRegistry: adrenaClient.vestRegistryPda,
        vest,
        systemProgram: SystemProgram.programId,
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
      label: 'Owner (vest owner pubkey)',
      initialValue: form.owner,
      type: InstructionInputType.INPUT,
      inputType: 'text',
      name: 'owner',
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
