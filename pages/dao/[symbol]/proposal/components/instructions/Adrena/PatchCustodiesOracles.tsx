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
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'

export interface PatchCustodiesOraclesForm {
  governedAccount: AssetAccount | null
}

export default function PatchCustodiesOracles({
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

  const [form, setForm] = useState<PatchCustodiesOraclesForm>({
    governedAccount: null,
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

    if (!isValid || !governance || !adrenaClient|| !wallet?.publicKey) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const instruction = await adrenaClient.program.methods
      .patchCustodiesOracles()
      .accountsStrict({
        cortex: adrenaClient.cortexPda,
        admin: governance.nativeTreasuryAddress,
        pool: new PublicKey('4bQRutgDJs6vuh6ZcWaPVXiQaBzbHketjbCDjL4oRN34'),
        usdcCustody: new PublicKey('Dk523LZeDQbZtUwPEBjFXCd2Au1tD7mWZBJJmcgHktNk'),
        bonkCustody: new PublicKey('8aJuzsgjxBnvRhDcfQBD7z4CUj7QoPEpaNwVd7KqsSk5'),
        jitoCustody: new PublicKey('GZ9XfWwgTRhkma2Y91Q9r1XKotNXYjBnKKabj19rhT71'),
        wbtcCustody: new PublicKey('GFu3qS22mo6bAjg4Lr5R7L8pPgHq6GvbjJPKEHkbbs2c'),
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
