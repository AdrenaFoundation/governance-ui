import { useContext, useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { serializeInstructionToBase64 } from '@solana/spl-governance'
import { Governance, ProgramAccount } from '@solana/spl-governance'

import { UiInstruction } from '@utils/uiTypes/proposalCreationTypes'
import useGovernanceAssets from '@hooks/useGovernanceAssets'
import { AccountType, AssetAccount } from '@utils/uiTypes/assets'
import useAdrenaClient from '@hooks/useAdrenaClient'
import { NewProposalContext } from '../../../new'
import InstructionForm, { InstructionInput } from '../FormCreator'
import { InstructionInputType } from '../inputInstructionType'

import IDL from '../../../../../../../idls/adrena.json'

// snake_case -> camelCase
const toCamelCase = (s: string): string =>
  s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// Derive a PDA address for accounts with only const seeds
function derivePda(
  seeds: Array<{ kind: string; value?: number[] }>,
  programId: PublicKey,
): PublicKey | null {
  try {
    const buffers = seeds.map((s) => {
      if (s.kind === 'const' && s.value) return Buffer.from(s.value)
      return null
    })
    if (buffers.some((b) => b === null)) return null
    return PublicKey.findProgramAddressSync(buffers as Buffer[], programId)[0]
  } catch {
    return null
  }
}

type IdlAccount = {
  name: string
  writable?: boolean
  signer?: boolean
  pda?: { seeds: Array<{ kind: string; value?: number[] }> }
  docs?: string[]
}

type IdlArgType =
  | string
  | { defined: { name: string } }
  | { option: IdlArgType }
  | { vec: IdlArgType }
  | { array: [IdlArgType, number] }

type IdlArg = {
  name: string
  type: IdlArgType
}

type IdlInstruction = {
  name: string
  accounts: IdlAccount[]
  args: IdlArg[]
}

function argTypeLabel(t: IdlArgType): string {
  if (typeof t === 'string') return t
  if ('defined' in t) return t.defined.name
  if ('option' in t) return `Option<${argTypeLabel(t.option)}>`
  if ('vec' in t) return `Vec<${argTypeLabel(t.vec)}>`
  if ('array' in t) return `[${argTypeLabel(t.array[0])}; ${t.array[1]}]`
  return 'unknown'
}

function isPrimitive(t: IdlArgType): boolean {
  if (typeof t !== 'string') return false
  return ['bool', 'u8', 'u16', 'u32', 'u64', 'u128', 'i8', 'i16', 'i32', 'i64', 'i128', 'f32', 'f64', 'string', 'publicKey', 'bytes'].includes(t)
}

export interface AdrenaIdlInstructionForm {
  governedAccount: AssetAccount | null
  idlInstructionName: string
  accounts: Record<string, string>
  args: Record<string, string>
}

export default function AdrenaIdlInstruction({
  index,
  governance,
}: {
  index: number
  governance: ProgramAccount<Governance> | null
}) {
  const { assetAccounts } = useGovernanceAssets()
  const shouldBeGoverned = !!(index !== 0 && governance)
  const programGovernances = assetAccounts.filter(
    (x) => x.type === AccountType.PROGRAM,
  )

  const [form, setForm] = useState<AdrenaIdlInstructionForm>({
    governedAccount: null,
    idlInstructionName: '',
    accounts: {},
    args: {},
  })
  const [formErrors, setFormErrors] = useState({})
  const { handleSetInstructions } = useContext(NewProposalContext)

  const adrenaClient = useAdrenaClient(form.governedAccount?.pubkey ?? null)

  // All IDL instructions sorted alphabetically
  const idlInstructions = useMemo<IdlInstruction[]>(
    () =>
      [...(IDL.instructions as unknown as IdlInstruction[])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [],
  )

  const selectedIxDef = useMemo<IdlInstruction | null>(
    () =>
      idlInstructions.find((ix) => ix.name === form.idlInstructionName) ?? null,
    [idlInstructions, form.idlInstructionName],
  )

  // When governance/programId changes, auto-derive const-seed PDAs
  useEffect(() => {
    if (!selectedIxDef || !adrenaClient) return

    const derived: Record<string, string> = { ...form.accounts }
    for (const acc of selectedIxDef.accounts) {
      const camel = toCamelCase(acc.name)
      if (derived[camel]) continue // already filled
      if (acc.pda) {
        const addr = derivePda(acc.pda.seeds, adrenaClient.programId)
        if (addr) derived[camel] = addr.toBase58()
      }
    }
    setForm((prev) => ({ ...prev, accounts: derived }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIxDef, adrenaClient?.programId?.toBase58()])

  async function getInstruction(): Promise<UiInstruction> {
    const gov = form.governedAccount?.governance
    const empty: UiInstruction = {
      serializedInstruction: '',
      isValid: false,
      governance: gov,
      chunkBy: 1,
    }

    if (!adrenaClient || !selectedIxDef || !gov) return empty

    try {
      // Build accounts object
      const accountsObj: Record<string, PublicKey> = {}
      for (const acc of selectedIxDef.accounts) {
        const camel = toCamelCase(acc.name)
        const val = form.accounts[camel]
        if (!val) {
          setFormErrors((e) => ({ ...e, [camel]: `${acc.name} is required` }))
          return { ...empty }
        }
        accountsObj[camel] = new PublicKey(val)
      }

      // Build args array — each arg parsed from its JSON textarea
      const argsArr: unknown[] = selectedIxDef.args.map((arg) => {
        const raw = form.args[arg.name] ?? ''
        if (isPrimitive(arg.type)) {
          if (arg.type === 'bool') return raw === 'true'
          if (arg.type === 'publicKey') return new PublicKey(raw)
          if (arg.type === 'string') return raw
          // numeric
          return Number(raw)
        }
        try {
          return JSON.parse(raw)
        } catch {
          throw new Error(`Invalid JSON for arg "${arg.name}"`)
        }
      })

      const camelMethod = toCamelCase(selectedIxDef.name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const method = (adrenaClient.program.methods as any)[camelMethod]
      if (!method) throw new Error(`Method ${camelMethod} not found on program`)

      const instruction = await method(...argsArr)
        .accountsStrict(accountsObj)
        .instruction()

      return {
        serializedInstruction: serializeInstructionToBase64(instruction),
        isValid: true,
        governance: gov,
        chunkBy: 1,
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setFormErrors((prev) => ({ ...prev, _build: msg }))
      return empty
    }
  }

  useEffect(() => {
    handleSetInstructions(
      { governedAccount: form.governedAccount?.governance, getInstruction },
      index,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  // Build dynamic inputs for accounts and args whenever instruction changes
  const dynamicAccountInputs: InstructionInput[] = useMemo(() => {
    if (!selectedIxDef) return []
    return selectedIxDef.accounts.map((acc) => {
      const camel = toCamelCase(acc.name)
      const label = `${acc.name}${acc.signer ? ' (signer)' : ''}${acc.writable ? ' (writable)' : ''}`
      const hasPda = !!acc.pda
      return {
        label,
        subtitle: hasPda ? 'PDA — auto-derived if possible' : undefined,
        initialValue: form.accounts[camel] ?? '',
        name: `accounts.${camel}`,
        type: InstructionInputType.INPUT,
        inputType: 'text',
        placeholder: hasPda ? 'auto-derived' : 'PublicKey',
      }
    })
  }, [selectedIxDef, form.accounts])

  const dynamicArgInputs: InstructionInput[] = useMemo(() => {
    if (!selectedIxDef) return []
    return selectedIxDef.args.map((arg) => {
      const typeLabel = argTypeLabel(arg.type)
      const primitive = isPrimitive(arg.type)
      return {
        label: `${arg.name}: ${typeLabel}`,
        subtitle: primitive ? undefined : 'Enter as JSON',
        initialValue: form.args[arg.name] ?? '',
        name: `args.${arg.name}`,
        type: primitive
          ? InstructionInputType.INPUT
          : InstructionInputType.TEXTAREA,
        inputType: primitive ? (arg.type === 'bool' ? 'text' : 'text') : undefined,
        placeholder: primitive
          ? String(arg.type) === 'bool'
            ? 'true / false'
            : String(arg.type)
          : `{ /* ${typeLabel} */ }`,
      }
    })
  }, [selectedIxDef, form.args])

  // Proxy setForm so that nested accounts.X and args.X keys work with InstructionForm.
  // InstructionForm calls setForm(flatObject) where keys include 'accounts.X' and 'args.X'.
  // We un-flatten those back into the real nested form shape.
  const setFormProxy = (
    updater: Record<string, unknown> | ((prev: AdrenaIdlInstructionForm) => Record<string, unknown>),
  ) => {
    setForm((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const nextAccounts = { ...prev.accounts }
      const nextArgs = { ...prev.args }
      let nextGoverned = prev.governedAccount
      let nextIxName = prev.idlInstructionName

      for (const [k, v] of Object.entries(next)) {
        if (k.startsWith('accounts.')) {
          nextAccounts[k.slice(9)] = v as string
        } else if (k.startsWith('args.')) {
          nextArgs[k.slice(5)] = v as string
        } else if (k === 'governedAccount') {
          nextGoverned = v as AssetAccount | null
        } else if (k === 'idlInstructionName') {
          nextIxName = v as string
        }
      }

      // When instruction changes, reset account/arg values
      if (nextIxName !== prev.idlInstructionName) {
        return { governedAccount: nextGoverned, idlInstructionName: nextIxName, accounts: {}, args: {} }
      }

      return { governedAccount: nextGoverned, idlInstructionName: nextIxName, accounts: nextAccounts, args: nextArgs }
    })
  }

  const instructionSelectInput: InstructionInput[] = [
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
      label: 'IDL Instruction',
      initialValue: form.idlInstructionName,
      name: 'idlInstructionName',
      type: InstructionInputType.SELECT,
      options: idlInstructions.map((ix) => ({
        name: ix.name,
        value: ix.name,
      })),
    },
  ]

  const allInputs: InstructionInput[] = [
    ...instructionSelectInput,
    ...dynamicAccountInputs,
    ...dynamicArgInputs,
  ]

  // Flatten form for InstructionForm — exclude nested accounts/args objects
  // to avoid conflicts with the flattened 'accounts.X' / 'args.X' keys.
  const flatForm = {
    governedAccount: form.governedAccount,
    idlInstructionName: form.idlInstructionName,
    ...Object.fromEntries(
      Object.entries(form.accounts).map(([k, v]) => [`accounts.${k}`, v]),
    ),
    ...Object.fromEntries(
      Object.entries(form.args).map(([k, v]) => [`args.${k}`, v]),
    ),
  }

  return (
    <div>
      {(formErrors as any)._build && (
        <div className="text-red mb-2 text-sm">{(formErrors as any)._build}</div>
      )}
      <InstructionForm
        outerForm={flatForm as any}
        setForm={setFormProxy as any}
        inputs={allInputs}
        setFormErrors={setFormErrors}
        formErrors={formErrors}
      />
    </div>
  )
}
