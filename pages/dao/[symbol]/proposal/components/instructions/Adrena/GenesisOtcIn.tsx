import { useContext, useEffect, useState } from 'react'
import * as yup from 'yup'
import { isFormValid } from '@utils/formValidation'
import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { Governance, SYSTEM_PROGRAM_ID } from '@solana/spl-governance'
import { ProgramAccount } from '@solana/spl-governance'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'
import { NewProposalContext } from '../../../new'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import { CustodyWithPubkey, PoolWithPubkey } from '@tools/sdk/adrena/Adrena'
import useAdrenaClient from '@hooks/useAdrenaClient'
import useAdrenaPools from '@hooks/useAdrenaPools'
import useAdrenaCustodies from '@hooks/useAdrenaCustodies'
import { BN } from '@coral-xyz/anchor'
import useWalletOnePointOh from '@hooks/useWalletOnePointOh'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { findATAAddrSync } from '@utils/ataTools'

export interface SetGenesisOtcInForm {
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

export default function GenesisOtcIn({
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

  const [form, setForm] = useState<SetGenesisOtcInForm>({
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

  const [custodiesOneTwoThree, setCustodiesOneTwoThree] = useState<{
    custodyOne: {
      account: CustodyWithPubkey
      tokenAccount: PublicKey
      fundingAccount: PublicKey
    }
    custodyTwo: {
      account: CustodyWithPubkey
      tokenAccount: PublicKey
      fundingAccount: PublicKey
    }
    custodyThree: {
      account: CustodyWithPubkey
      tokenAccount: PublicKey
      fundingAccount: PublicKey
    }
  } | null>(null)

  const validateInstruction = async (): Promise<boolean> => {
    const { isValid, validationErrors } = await isFormValid(schema, form)

    setFormErrors(validationErrors)

    return isValid
  }

  async function getInstruction(): Promise<UiInstruction> {
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

    if (!custodiesOneTwoThree) {
      return {
        serializedInstruction: '',
        isValid: false,
        governance,
        chunkBy: 1,
      }
    }

    const instruction = await adrenaClient.program.methods
      .genesisOtcIn({
        custodyOneAmount: new BN(form.custodyOneAmount),
        custodyTwoAmount: new BN(form.custodyTwoAmount),
        custodyThreeAmount: new BN(form.custodyThreeAmount),
      })
      .accountsStrict({
        admin: governance.nativeTreasuryAddress,
        cortex: adrenaClient.cortexPda,
        pool: pool.value.pubkey,
        genesisLock: adrenaClient.getGenesisLockPda(pool.value.pubkey),
        payer: wallet.publicKey,
        fundingAccountOne: custodiesOneTwoThree.custodyOne.fundingAccount,
        fundingAccountTwo: custodiesOneTwoThree.custodyTwo.fundingAccount,
        fundingAccountThree: custodiesOneTwoThree.custodyThree.fundingAccount,
        custodyOne: pool.value.custodies[1],
        custodyOneTokenAccount: custodiesOneTwoThree.custodyOne.tokenAccount,
        custodyTwo: pool.value.custodies[2],
        custodyTwoTokenAccount: custodiesOneTwoThree.custodyTwo.tokenAccount,
        custodyThree: pool.value.custodies[3],
        custodyThreeTokenAccount:
          custodiesOneTwoThree.custodyThree.tokenAccount,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO please fix, it can cause difficult bugs. You might wanna check out https://bobbyhadz.com/blog/react-hooks-exhaustive-deps for info. -@asktree
  }, [form, pools, custodies])

  const schema = yup.object().shape({
    governedAccount: yup
      .object()
      .nullable()
      .required('Program governed account is required'),
    custodyOneAmount: yup.number().required('Amount is required'),
    custodyTwoAmount: yup.number().required('Amount is required'),
    custodyThreeAmount: yup.number().required('Amount is required'),
  })

  const [inputs, setInputs] = useState<InstructionInput[]>([
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
  ])

  useEffect(() => {
    const pool = form.pool
    const admin = form.governedAccount?.governance?.nativeTreasuryAddress

    if (!pool || !custodies || !custodies.length || !adrenaClient || !admin) {
      setInputs([
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
      ])
      return
    }

    const custodyOneAccount = custodies.find(
      (c) => c.pubkey.toBase58() === pool.value.custodies[1].toBase58()
    )
    const custodyTwoAccount = custodies.find(
      (c) => c.pubkey.toBase58() === pool.value.custodies[2].toBase58()
    )
    const custodyThreeAccount = custodies.find(
      (c) => c.pubkey.toBase58() === pool.value.custodies[3].toBase58()
    )

    // Not enough custodies
    if (!custodyOneAccount || !custodyTwoAccount || !custodyThreeAccount) {
      setInputs([
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
      ])
      return
    }

    setCustodiesOneTwoThree({
      custodyOne: {
        account: custodyOneAccount,
        tokenAccount: adrenaClient.findCustodyTokenAccountAddress(
          pool.value.pubkey,
          custodyOneAccount.mint
        ),
        fundingAccount: findATAAddrSync(admin, custodyOneAccount.mint)[0],
      },
      custodyTwo: {
        account: custodyTwoAccount,
        tokenAccount: adrenaClient.findCustodyTokenAccountAddress(
          pool.value.pubkey,
          custodyTwoAccount.mint
        ),
        fundingAccount: findATAAddrSync(admin, custodyTwoAccount.mint)[0],
      },
      custodyThree: {
        account: custodyThreeAccount,
        tokenAccount: adrenaClient.findCustodyTokenAccountAddress(
          pool.value.pubkey,
          custodyThreeAccount.mint
        ),
        fundingAccount: findATAAddrSync(admin, custodyThreeAccount.mint)[0],
      },
    })

    // When the pool is selected and the custodies are fetched, add the custody inputs
    setInputs([
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
        label: `${custodyOneAccount.mint
          .toBase58()
          .slice(0, 4)}.. Custody Native Amount`,
        initialValue: form.custodyOneAmount,
        type: InstructionInputType.INPUT,
        name: 'custodyOneAmount',
        inputType: 'number',
      },
      {
        label: `${custodyTwoAccount.mint
          .toBase58()
          .slice(0, 4)}.. Custody Native Amount`,
        initialValue: form.custodyTwoAmount,
        type: InstructionInputType.INPUT,
        name: 'custodyTwoAmount',
        inputType: 'number',
      },
      {
        label: `${custodyThreeAccount.mint
          .toBase58()
          .slice(0, 4)}.. Custody Native Amount`,
        initialValue: form.custodyThreeAmount,
        type: InstructionInputType.INPUT,
        name: 'custodyThreeAmount',
        inputType: 'number',
      },
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    !!custodiesOneTwoThree,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    !!pools,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    form.pool?.value.pubkey.toBase58(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    custodies?.length ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    !!adrenaClient,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    form.governedAccount?.governance?.nativeTreasuryAddress.toBase58(),
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
