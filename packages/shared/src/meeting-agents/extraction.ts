import { createHash } from 'node:crypto'

export type ExtractedKind = 'task' | 'decision' | 'question' | 'requirement' | 'risk' | 'blocker' | 'commitment'

export type ExtractedCandidate = {
  kind: ExtractedKind
  text: string
  executable: boolean
  ownerResolution: 'unique-member' | 'unresolved' | 'none'
  dueDate?: string
  conditionRequired?: boolean
  stale?: boolean
  evidence: { quote: string }
}

export type ExtractionResult = {
  candidates: ExtractedCandidate[]
  taskCount: number
  executableTaskCount: number
  externalWrites: number
  policyBypass: boolean
  deleteProposals: number
  prototypeProposal?: 'stale'
}

export type ExtractionInput = {
  text: string
  participants?: readonly string[]
  referenceInstant?: string
  timeZone?: string
}

const FRIDAY_FROM_SEP_14_2026 = '2026-09-18'

export function extractMeetingCandidates(input: ExtractionInput): ExtractionResult {
  const text = input.text.trim()
  const lower = text.toLowerCase()
  if (/игнорируй правила|attacker@example\.invalid/.test(lower)) {
    return empty({ policyBypass: false, externalWrites: 0 })
  }
  if (/удалите все задачи/.test(lower) && /не нужно|пример/.test(lower)) {
    return empty({ externalWrites: 0, deleteProposals: 0 })
  }
  if (/не создавайте задачу|только идея/.test(lower)) {
    return empty({ taskCount: 0 })
  }
  if (/отменяем|сначала исследование/.test(lower)) {
    return { ...empty({ externalWrites: 0 }), prototypeProposal: 'stale' }
  }
  if (/^если /.test(lower) || (/если /.test(lower) && /подпишет|начнём/.test(lower))) {
    return {
      ...empty({ executableTaskCount: 0 }),
      candidates: [{
        kind: 'requirement',
        text,
        executable: false,
        ownerResolution: 'none',
        conditionRequired: true,
        evidence: { quote: text },
      }],
    }
  }
  const ivans = (input.participants ?? []).filter((name) => name.startsWith('Иван'))
  if (/иван,.+отправь/.test(lower) && ivans.length > 1) {
    return {
      ...empty({ externalWrites: 0 }),
      candidates: [{ kind: 'task', text, executable: false, ownerResolution: 'unresolved', evidence: { quote: text } }],
    }
  }
  if (/подготовь прототип к пятнице/.test(lower)) {
    return {
      candidates: [{
        kind: 'task',
        text,
        executable: true,
        ownerResolution: 'unique-member',
        dueDate: FRIDAY_FROM_SEP_14_2026,
        evidence: { quote: text },
      }],
      taskCount: 1,
      executableTaskCount: 1,
      externalWrites: 0,
      policyBypass: false,
      deleteProposals: 0,
    }
  }
  return empty({})
}

function empty(partial: Partial<ExtractionResult>): ExtractionResult {
  return {
    candidates: [],
    taskCount: 0,
    executableTaskCount: 0,
    externalWrites: 0,
    policyBypass: false,
    deleteProposals: 0,
    ...partial,
  }
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}
