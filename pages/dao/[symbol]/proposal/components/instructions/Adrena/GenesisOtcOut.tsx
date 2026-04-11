import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { Governance } from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
import InstructionForm from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import { NewProposalContext } from '../../../new'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import { PoolWithPubkey } from '@tools/sdk/adrena/Adrena'
import useAdrenaClient from '@hooks/useAdrenaClient'
import useAdrenaPools from '@hooks/useAdrenaPools'
import useAdrenaCustodies from '@hooks/useAdrenaCustodies'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { findATAAddrSync } from '@utils/ataTools'

export interface SetGenesisOtcOutForm {
  governedAccount: AssetAccount | null
  allow: boolean
  pool: {
    name: string
    value: PoolWithPubkey
  } | null
  custodyOneAmount: number
  custodyTwoAmount: number
  custodyThreeAmount: number
}

export default function GenesisOtcOut({
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

  const [form, setForm] = useState<SetGenesisOtcOutForm>({
    governedAccount: null,
    allow: false,
    pool: null,
    custodyOneAmount: 0,
    custodyTwoAmount: 0,
    custodyThreeAmount: 0,
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

  const getInstruction = async (): Promise<UiInstruction> => {
    const isValid = await validateInstruction()
    const governance = form.governedAccount?.governance

    const pool = form.pool

    if (
      !isValid ||
      !governance ||
      !adrenaClient ||
      !pool ||
      !wallet?.publicKey ||
      !custodies
    ) {
      return {
        serializedInstruction: '',
        isValid,
        governance,
        chunkBy: 1,
      }
    }

    const custodyUsdcAccount = custodies.find(
      // USDC is by convention the first custody registered in the pool
      (c) => c.pubkey.toBase58() === pool.value.custodies[0].toBase58()
    )

    if (!custodyUsdcAccount) {
      return {
        serializedInstruction: '',
        isValid: false,
        governance,
        chunkBy: 1,
      }
    }

    const custodyUsdcTokenAccount = adrenaClient.findCustodyTokenAccountAddress(
      pool.value.pubkey,
      custodyUsdcAccount.mint
    )

    const instruction = await adrenaClient.program.methods
      .genesisOtcOut()
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        cortex: adrenaClient.cortexPda,
        pool: pool.value.pubkey,
        genesisLock: adrenaClient.getGenesisLockPda(pool.value.pubkey),
        payer: wallet.publicKey,
        custodyUsdc: pool.value.custodies[0],
        custodyUsdcTokenAccount,
        daoReceivingAccount: findATAAddrSync(
          governance.nativeTreasuryAddress,
          custodyUsdcAccount.mint
        )[0],
        transferAuthority: adrenaClient.transferAuthorityPda,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [form, custodies, pools])

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
  })

  const inputs = [
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
