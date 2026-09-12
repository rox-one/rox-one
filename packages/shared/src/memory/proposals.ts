/**
 * Session-learning memory proposals (Rox tracker Issue 13).
 *
 * A proposal is a reviewable inference. It never writes a lesson, credential
 * or durable instruction until the user picks Global or This project.
 */

export const ROX_PROPOSAL_MODEL_POLICY = {
  model: 'rox/fast',
  maxTokens: 512,
  maxProposalsPerExtract: 8,
} as const

export type MemoryProposalKind =
  | 'fact'
  | 'preference'
  | 'rule'
  | 'event'
  | 'credential_ref'
  | 'recurring_action'

export type MemoryProposalStatus =
  | 'pending'
  | 'approved_global'
  | 'approved_project'
  | 'rejected'
  | 'deleted'

export type MemoryProposalTrigger = 'activity' | 'close' | 'brain'

export type MemoryProposalScope = 'global' | 'project'

export interface MemoryProposalConflict {
  existingRule: string
  relation: 'contradicts' | 'subsumes'
}

export interface MemoryProposalCredentialRef {
  /** Service or vault key name — never the secret material. */
  service: string
  accountHint?: string
}

export interface MemoryProposalCost {
  tokens: number
  model: string
}

export interface MemoryProposal {
  id: string
  text: string
  kind: MemoryProposalKind
  status: MemoryProposalStatus
  sessionId: string
  workspaceId: string
  projectId?: string
  sourceMessageIds: string[]
  provenance: {
    trigger: MemoryProposalTrigger
    consentEventId?: string
  }
  riskFlags: string[]
  expiresAt?: string
  conflicts: MemoryProposalConflict[]
  credentialRef?: MemoryProposalCredentialRef
  editHistory: Array<{ ts: string; text: string }>
  createdAt: string
  updatedAt: string
  cost: MemoryProposalCost
}

export interface TranscriptMessage {
  id: string
  role: string
  content: string
}

export interface ExtractProposalsInput {
  sessionId: string
  workspaceId: string
  projectId?: string
  trigger: MemoryProposalTrigger
  messages: TranscriptMessage[]
  existingRules?: string[]
  now?: Date
  idFactory?: () => string
}

const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|Bearer\s+[A-Za-z0-9._\-]+)/gi
const KEY_VALUE_SECRET = /\b(?:api[_-]?key|password|secret|token|passwd)\s*[:=]\s*['"]?([^\s'"]{8,})/gi
const RULE_HINT = /\b(always|never|must not|don't|do not|prefer|please remember)\b/i
const RECURRING_HINT = /\b(every|each)\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
const EVENT_HINT = /\b(on|due|meeting|deadline)\b.{0,40}\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2})\b/i
const PREFERENCE_HINT = /\b(prefer|i like|please use|i want)\b/i

function nextId(factory?: () => string): string {
  if (factory) return factory()
  return `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function estimateProposalTokens(text: string): number {
  return Math.max(1, Math.ceil((text ?? '').length / 4))
}

export function looksLikeSecret(text: string): boolean {
  SECRET_VALUE.lastIndex = 0
  KEY_VALUE_SECRET.lastIndex = 0
  return SECRET_VALUE.test(text) || KEY_VALUE_SECRET.test(text)
}

export function credentialRefFromText(text: string): MemoryProposalCredentialRef | undefined {
  const serviceMatch = text.match(/\b(?:api[_-]?key|password|secret|token)\b/i)
  if (!serviceMatch && !looksLikeSecret(text)) return undefined
  const host = text.match(/\b([a-z0-9.-]+\.[a-z]{2,})\b/i)?.[1]
  return {
    service: host ?? serviceMatch?.[0]?.toLowerCase() ?? 'credential',
  }
}

export function redactProposalSecrets(text: string): string {
  return text
    .replace(SECRET_VALUE, '[credential-ref]')
    .replace(KEY_VALUE_SECRET, (full, value: string) => full.replace(value, '[credential-ref]'))
}

export function classifyProposalKind(text: string): MemoryProposalKind {
  if (looksLikeSecret(text) || /\b(api[_-]?key|password|secret|token|passkey)\b/i.test(text)) {
    return 'credential_ref'
  }
  if (RECURRING_HINT.test(text)) return 'recurring_action'
  if (EVENT_HINT.test(text)) return 'event'
  if (PREFERENCE_HINT.test(text) && !RULE_HINT.test(text.replace(PREFERENCE_HINT, ''))) return 'preference'
  if (RULE_HINT.test(text)) return 'rule'
  return 'fact'
}

export function detectProposalConflicts(text: string, existingRules: string[]): MemoryProposalConflict[] {
  const needle = text.trim().toLowerCase()
  const conflicts: MemoryProposalConflict[] = []
  for (const rule of existingRules) {
    const hay = rule.trim().toLowerCase()
    if (!hay) continue
    if (hay === needle) {
      conflicts.push({ existingRule: rule, relation: 'subsumes' })
      continue
    }
    const neverVsAlways = (hay.startsWith('always ') && needle.startsWith('never '))
      || (hay.startsWith('never ') && needle.startsWith('always '))
    if (neverVsAlways) {
      conflicts.push({ existingRule: rule, relation: 'contradicts' })
    }
  }
  return conflicts
}

function candidateLines(messages: TranscriptMessage[]): Array<{ id: string; text: string }> {
  const out: Array<{ id: string; text: string }> = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    for (const raw of message.content.split('\n')) {
      const text = raw.trim()
      if (text.length < 12 || text.length > 280) continue
      if (
        RULE_HINT.test(text)
        || PREFERENCE_HINT.test(text)
        || RECURRING_HINT.test(text)
        || EVENT_HINT.test(text)
        || looksLikeSecret(text)
      ) {
        out.push({ id: message.id, text })
      }
    }
  }
  return out
}

export function extractProposalsFromTranscript(input: ExtractProposalsInput): MemoryProposal[] {
  const now = (input.now ?? new Date()).toISOString()
  const seen = new Set<string>()
  const proposals: MemoryProposal[] = []

  for (const line of candidateLines(input.messages)) {
    if (proposals.length >= ROX_PROPOSAL_MODEL_POLICY.maxProposalsPerExtract) break
    const kind = classifyProposalKind(line.text)
    const text = kind === 'credential_ref' ? redactProposalSecrets(line.text) : line.text
    const key = `${kind}:${text.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const credentialRef = kind === 'credential_ref' ? credentialRefFromText(line.text) : undefined
    const riskFlags: string[] = []
    if (kind === 'credential_ref') riskFlags.push('credential-reference-only')
    if (looksLikeSecret(line.text)) riskFlags.push('secret-redacted')

    const tokens = estimateProposalTokens(text)
    proposals.push({
      id: nextId(input.idFactory),
      text,
      kind,
      status: 'pending',
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceMessageIds: [line.id],
      provenance: { trigger: input.trigger },
      riskFlags,
      conflicts: detectProposalConflicts(text, input.existingRules ?? []),
      credentialRef,
      editHistory: [],
      createdAt: now,
      updatedAt: now,
      cost: { tokens, model: ROX_PROPOSAL_MODEL_POLICY.model },
    })
  }

  return proposals
}

export interface ApproveProposalInput {
  proposal: MemoryProposal
  scope: MemoryProposalScope
  editedText?: string
  projectId?: string
  now?: Date
  consentEventId?: string
}

export interface ApproveProposalResult {
  proposal: MemoryProposal
  /** Lesson payload when the proposal may become durable. Absent for credentials. */
  lesson: { rule: string; category: 'preference' | 'workflow' | 'knowledge'; scope: 'global' | 'workspace' } | null
}

export function editProposal(proposal: MemoryProposal, text: string, now = new Date()): MemoryProposal {
  const trimmed = redactProposalSecrets(text.trim())
  if (!trimmed) return proposal
  return {
    ...proposal,
    text: trimmed,
    kind: classifyProposalKind(trimmed),
    editHistory: [...proposal.editHistory, { ts: now.toISOString(), text: proposal.text }],
    updatedAt: now.toISOString(),
  }
}

export function approveProposal(input: ApproveProposalInput): ApproveProposalResult {
  const now = (input.now ?? new Date()).toISOString()
  const edited = input.editedText ? editProposal(input.proposal, input.editedText, input.now) : input.proposal
  const consentEventId = input.consentEventId ?? `consent_${edited.id}_${input.scope}`
  const status: MemoryProposalStatus = input.scope === 'global' ? 'approved_global' : 'approved_project'
  const projectId = input.scope === 'project' ? (input.projectId ?? edited.projectId) : edited.projectId

  const next: MemoryProposal = {
    ...edited,
    status,
    projectId,
    provenance: { ...edited.provenance, consentEventId },
    updatedAt: now,
  }

  if (next.kind === 'credential_ref') {
    return { proposal: next, lesson: null }
  }

  const category = next.kind === 'preference' ? 'preference' : next.kind === 'fact' ? 'knowledge' : 'workflow'
  return {
    proposal: next,
    lesson: {
      rule: next.text,
      category,
      scope: input.scope === 'global' ? 'global' : 'workspace',
    },
  }
}

export function rejectProposal(proposal: MemoryProposal, now = new Date()): MemoryProposal {
  return { ...proposal, status: 'rejected', updatedAt: now.toISOString() }
}

export function deleteProposal(proposal: MemoryProposal, now = new Date()): MemoryProposal {
  return { ...proposal, status: 'deleted', updatedAt: now.toISOString() }
}

export function isPendingProposal(proposal: MemoryProposal, now = new Date()): boolean {
  if (proposal.status !== 'pending') return false
  if (!proposal.expiresAt) return true
  return Date.parse(proposal.expiresAt) > now.getTime()
}

export function applyProjectOnly(proposal: MemoryProposal): boolean {
  return proposal.status === 'approved_project' && Boolean(proposal.projectId)
}
