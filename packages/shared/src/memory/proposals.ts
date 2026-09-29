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

/**
 * Russian hints. `\b` is ASCII-only in JS regexes, so it never matches next to
 * Cyrillic letters; these use Unicode-aware letter lookarounds with the `u` flag.
 */
const L_START = '(?<![\\p{L}\\p{N}_])'
const L_END = '(?![\\p{L}\\p{N}_])'
function ruWords(body: string): RegExp {
  return new RegExp(`${L_START}(?:${body})${L_END}`, 'iu')
}
const RULE_HINT_RU = ruWords('всегда|никогда|нельзя|не надо|не нужно|не стоит|обязательно|запомни|запомните|не забывай|должен|должна|должны|не используй|не делай|только через')
const PREFERENCE_HINT_RU = ruWords('предпочитаю|предпочитаем|мне нравится|мне удобнее|я хочу|хочу чтобы|хочу, чтобы|используй|пиши|отвечай|лучше всего')
const RECURRING_HINT_RU = ruWords('(?:каждый|каждую|каждое|каждые)\\s+(?:день|утро|вечер|неделю|месяц|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|дня|недели)|ежедневно|еженедельно|ежемесячно|по утрам|по вечерам|по понедельникам|по вторникам|по средам|по четвергам|по пятницам|по субботам|по воскресеньям')
const EVENT_HINT_RU = new RegExp(`${L_START}(?:встреча|встречу|созвон|дедлайн|срок|до|к)${L_END}.{0,40}(?:\\d{1,2}[./]\\d{1,2}|20\\d{2}|${L_START}(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)${L_END})`, 'iu')
const CREDENTIAL_HINT_RU = ruWords('пароль|пароля|токен|токена|api-ключ|ключ api|секрет|секретный ключ')

export function isRuleHint(text: string): boolean {
  return RULE_HINT.test(text) || RULE_HINT_RU.test(text)
}
export function isPreferenceHint(text: string): boolean {
  return PREFERENCE_HINT.test(text) || PREFERENCE_HINT_RU.test(text)
}
export function isRecurringHint(text: string): boolean {
  return RECURRING_HINT.test(text) || RECURRING_HINT_RU.test(text)
}
export function isEventHint(text: string): boolean {
  return EVENT_HINT.test(text) || EVENT_HINT_RU.test(text)
}

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
  if (
    looksLikeSecret(text)
    || /\b(api[_-]?key|password|secret|token|passkey)\b/i.test(text)
    || CREDENTIAL_HINT_RU.test(text)
  ) {
    return 'credential_ref'
  }
  if (isRecurringHint(text)) return 'recurring_action'
  if (isEventHint(text)) return 'event'
  const withoutPreference = text.replace(PREFERENCE_HINT, '').replace(PREFERENCE_HINT_RU, '')
  if (isPreferenceHint(text) && !isRuleHint(withoutPreference)) return 'preference'
  if (isRuleHint(text)) return 'rule'
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
        isRuleHint(text)
        || isPreferenceHint(text)
        || isRecurringHint(text)
        || isEventHint(text)
        || looksLikeSecret(text)
      ) {
        out.push({ id: message.id, text })
      }
    }
  }
  return out
}

interface ProposalCandidate {
  text: string
  kind?: MemoryProposalKind
  sourceMessageIds: string[]
}

function buildProposalsFromCandidates(
  input: ExtractProposalsInput,
  candidates: ProposalCandidate[],
  model: string,
): MemoryProposal[] {
  const now = (input.now ?? new Date()).toISOString()
  const seen = new Set<string>()
  const proposals: MemoryProposal[] = []

  for (const candidate of candidates) {
    if (proposals.length >= ROX_PROPOSAL_MODEL_POLICY.maxProposalsPerExtract) break
    const raw = candidate.text.trim()
    if (!raw) continue
    const secret = looksLikeSecret(raw)
    const kind: MemoryProposalKind = secret ? 'credential_ref' : (candidate.kind ?? classifyProposalKind(raw))
    const text = kind === 'credential_ref' || secret ? redactProposalSecrets(raw) : raw
    const key = `${kind}:${text.trim().toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)

    const credentialRef = kind === 'credential_ref' ? credentialRefFromText(raw) : undefined
    const riskFlags: string[] = []
    if (kind === 'credential_ref') riskFlags.push('credential-reference-only')
    if (secret) riskFlags.push('secret-redacted')

    const tokens = estimateProposalTokens(text)
    proposals.push({
      id: nextId(input.idFactory),
      text,
      kind,
      status: 'pending',
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sourceMessageIds: candidate.sourceMessageIds,
      provenance: { trigger: input.trigger },
      riskFlags,
      conflicts: detectProposalConflicts(text, input.existingRules ?? []),
      credentialRef,
      editHistory: [],
      createdAt: now,
      updatedAt: now,
      cost: { tokens, model },
    })
  }

  return proposals
}

export function extractProposalsFromTranscript(input: ExtractProposalsInput): MemoryProposal[] {
  const candidates = candidateLines(input.messages).map((line) => ({
    text: line.text,
    sourceMessageIds: [line.id],
  }))
  return buildProposalsFromCandidates(input, candidates, ROX_PROPOSAL_MODEL_POLICY.model)
}

/** Messages the extractor actually reads (user/assistant turns with text). */
export function proposalTranscriptMessages(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0,
  )
}

const LLM_TRANSCRIPT_MAX_CHARS = 24_000
const LLM_MESSAGE_MAX_CHARS = 1_500
const LLM_PROPOSAL_KINDS: ReadonlyArray<MemoryProposalKind> = [
  'fact',
  'preference',
  'rule',
  'event',
  'recurring_action',
]

export interface ProposalExtractionPrompt {
  systemPrompt: string
  prompt: string
  /** 1-based index in the prompt → message id, for mapping sources back. */
  indexToMessageId: string[]
}

/**
 * Prompt for real LLM extraction (rox/fast or the connection's mini model).
 * The most recent messages are kept when the transcript is long.
 */
export function buildProposalExtractionPrompt(
  messages: TranscriptMessage[],
  existingRules: string[] = [],
): ProposalExtractionPrompt {
  const usable = proposalTranscriptMessages(messages)
  const picked: TranscriptMessage[] = []
  let budget = LLM_TRANSCRIPT_MAX_CHARS
  for (let i = usable.length - 1; i >= 0 && budget > 0; i--) {
    const m = usable[i]!
    const content = m.content.length > LLM_MESSAGE_MAX_CHARS ? `${m.content.slice(0, LLM_MESSAGE_MAX_CHARS)}…` : m.content
    budget -= content.length
    picked.unshift({ ...m, content })
  }
  const indexToMessageId = picked.map((m) => m.id)
  const transcript = picked
    .map((m, i) => `#${i + 1} [${m.role}]\n${redactProposalSecrets(m.content)}`)
    .join('\n\n')
  const rules = existingRules.slice(0, 40).map((r) => `- ${r}`).join('\n')

  const systemPrompt = [
    'You extract durable memory from a chat between a user and an AI assistant.',
    'Return things worth remembering for FUTURE sessions: stable facts about the user or their projects,',
    'preferences, explicit rules ("always/never"), upcoming events with dates, and recurring actions.',
    'Skip one-off task details, chit-chat, and anything already covered by the existing rules.',
    'Never include secret values (passwords, tokens, keys); mention only which service needs a credential.',
    'Write each item as one short standalone sentence in the language of the conversation.',
    `Return at most ${ROX_PROPOSAL_MODEL_POLICY.maxProposalsPerExtract} items. It is fine to return none.`,
    'Respond with JSON only, no prose, in this exact shape:',
    '{"proposals":[{"text":"...","kind":"fact|preference|rule|event|recurring_action","sources":[1]}]}',
    '"sources" are the #numbers of the messages the item came from.',
  ].join('\n')

  const prompt = [
    rules ? `Existing rules (do not repeat):\n${rules}\n` : '',
    'Conversation:',
    transcript,
  ].filter(Boolean).join('\n')

  return { systemPrompt, prompt, indexToMessageId }
}

/**
 * Parse the model's JSON answer. Returns null when the output is not the
 * expected shape (caller falls back to the regex extractor).
 */
export function parseProposalExtractionResponse(
  text: string,
  indexToMessageId: string[],
): ProposalCandidate[] | null {
  if (!text) return null
  let body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const firstBrace = body.search(/[[{]/)
  if (firstBrace < 0) return null
  body = body.slice(firstBrace)
  const lastBrace = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (lastBrace < 0) return null
  body = body.slice(0, lastBrace + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { proposals?: unknown }).proposals))
      ? (parsed as { proposals: unknown[] }).proposals
      : null
  if (!list) return null
  const out: ProposalCandidate[] = []
  for (const item of list) {
    const obj = typeof item === 'string' ? { text: item } : item
    if (!obj || typeof obj !== 'object') continue
    const rawText = (obj as { text?: unknown }).text
    if (typeof rawText !== 'string' || !rawText.trim()) continue
    const rawKind = (obj as { kind?: unknown }).kind
    const kind = typeof rawKind === 'string' && (LLM_PROPOSAL_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as MemoryProposalKind)
      : undefined
    const rawSources = (obj as { sources?: unknown }).sources
    const sourceMessageIds = Array.isArray(rawSources)
      ? rawSources
        .map((n) => (typeof n === 'number' ? indexToMessageId[n - 1] : typeof n === 'string' ? indexToMessageId[Number(n) - 1] : undefined))
        .filter((id): id is string => typeof id === 'string')
      : []
    out.push({ text: rawText.trim().slice(0, 280), kind, sourceMessageIds })
  }
  return out
}

/** Build proposals from a parsed LLM answer (same validation/redaction as the regex path). */
export function proposalsFromLlmCandidates(
  input: ExtractProposalsInput,
  candidates: ProposalCandidate[],
  model: string = ROX_PROPOSAL_MODEL_POLICY.model,
): MemoryProposal[] {
  return buildProposalsFromCandidates(input, candidates, model)
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
