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
import { getMintNaturalAmountFromDecimalAsBN } from '@tools/sdk/units'
import { OriginBucket } from '@tools/sdk/adrena/Adrena'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { findATAAddrSync } from '@utils/ataTools'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import useAdrenaClient from '@hooks/useAdrenaClient'
import useLegacyConnectionContext from '@hooks/useLegacyConnectionContext'
import { createAssociatedTokenAccountIdempotentInstruction } from '@blockworks-foundation/mango-v4'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'

export interface MintLmTokensFromBucketForm {
  governedAccount: AssetAccount | null
  owner: string
  originBucket: { name: string; value: OriginBucket }
  amount: number
  reason: string
}

export const ORIGIN_BUCKET_VALUES = [
  { name: 'Core Contributor', value: OriginBucket.CoreContributor },
  { name: 'Foundation', value: OriginBucket.Foundation },
  { name: 'Ecosystem', value: OriginBucket.Ecosystem },
]

export default function MintLmTokensFromBucket({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) {
  const { assetAccounts } = useGovernanceAssets()
  const shouldBeGoverned = !!(index !== 0 && governance)

  const programGovernances = assetAccounts.filter(
    (x) => x.type === AccountType.PROGRAM
  )

  const [form, setForm] = useState<MintLmTokensFromBucketForm>({
    governedAccount: null,
    owner: '',
    originBucket: ORIGIN_BUCKET_VALUES[3], // Ecosystem as default
    amount: 0,
    reason: '',
  })
  const [formErrors, setFormErrors] = useState({})

  const { handleSetInstructions } = useContext(NewProposalContext)

  const connection = useLegacyConnectionContext()
  const wallet = useWalletOnePointOh()

  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)

    setFormErrors(validationErrors)

    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
    const isValid = await validateInstruction()
    const governance = form.governedAccount?.governance

    if (!isValid || !governance || !adrenaClient || !wallet?.publicKey) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const owner = new PublicKey(form.owner)

    const receivingAccount = findATAAddrSync(owner, adrenaClient.lmTokenMint)[0]

    const preInstructions: TransactionInstruction[] = []

    if (!(await connection.current.getAccountInfo(receivingAccount))) {
      preInstructions.push(
        await createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          owner,
          adrenaClient.lmTokenMint
        )
      )
    }

    const instruction = await adrenaClient.program.methods
      .mintLmTokensFromBucket({
        bucketName: form.originBucket.value,
        amount: getMintNaturalAmountFromDecimalAsBN(
          form.amount,
          adrenaClient.lmTokenMintDecimals
        ),
        reason: form.reason,
      })
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        receivingAccount,
        transferAuthority: adrenaClient.transferAuthorityPda,
        cortex: adrenaClient.cortexPda,
        lmTokenTreasury: adrenaClient.lmTokenTreasury,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()

    return {
      serializedInstruction: serializeInstructionToBase64(instruction),
      prerequisiteInstructions: preInstructions,
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
    amount: yup.number().required('Token amount is required'),
    reason: yup.string().required('Reason is required'),
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
      label: 'Reason',
      initialValue: form.reason,
      type: InstructionInputType.INPUT,
      inputType: 'text',
      name: 'reason',
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
