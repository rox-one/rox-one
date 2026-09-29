/**
 * Решения — pure model: the decision log, filters, extraction prompt/parse and
 * the mapping decision → agent memory lessons (accepted decision = rule,
 * rejected options = MUST NOT rules). No I/O; see decisions-store.ts.
 */
import { matchesAnyTerm, normalizeTerms } from '@/lib/extra-screens/text-match'

export type DecisionStatus = 'accepted' | 'superseded' | 'reverted'
export type DecisionSourceKind = 'session' | 'meeting' | 'manual'

export interface RejectedOption {
  id: string
  text: string
  reason?: string
}

export interface DecisionSource {
  kind: DecisionSourceKind
  id?: string
  label?: string
}

export interface Decision {
  id: string
  /** What was decided. */
  title: string
  why: string
  who: string[]
  decidedAt: number
  status: DecisionStatus
  rejected: RejectedOption[]
  source: DecisionSource
  tags: string[]
  /** Expose to agents as memory lessons. */
  exposeToAgents: boolean
  /** Rule texts currently written to workspace memory for this decision. */
  syncedRules: string[]
  createdAt: number
  updatedAt: number
}

export interface DecisionCandidate {
  id: string
  title: string
  why: string
  who: string[]
  rejected: RejectedOption[]
  quote?: string
  source: DecisionSource
  extractionId: string
}

export interface DecisionExtraction {
  id: string
  /** Agent session that does the extraction. */
  sessionId: string
  source: DecisionSource
  startedAt: number
  parsedAt?: number
  failed?: boolean
  found?: number
}

export interface DecisionsData {
  decisions: Decision[]
  candidates: DecisionCandidate[]
  extractions: DecisionExtraction[]
}

export function emptyDecisionsData(): DecisionsData {
  return { decisions: [], candidates: [], extractions: [] }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const strList = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x).trim()).filter(Boolean) : [])

function normSource(v: unknown): DecisionSource {
  if (!v || typeof v !== 'object') return { kind: 'manual' }
  const o = v as Record<string, unknown>
  const kind = o.kind === 'session' || o.kind === 'meeting' ? o.kind : 'manual'
  return { kind, id: str(o.id) || undefined, label: str(o.label) || undefined }
}

function normRejected(v: unknown, prefix: string): RejectedOption[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((r, i): RejectedOption[] => {
    if (typeof r === 'string') return r.trim() ? [{ id: `${prefix}-${i}`, text: r.trim() }] : []
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    const text = (str(o.text) || str(o.option)).trim()
    if (!text) return []
    return [{ id: str(o.id) || `${prefix}-${i}`, text, reason: str(o.reason).trim() || undefined }]
  })
}

export function normalizeDecisionsData(raw: unknown): DecisionsData {
  if (!raw || typeof raw !== 'object') return emptyDecisionsData()
  const r = raw as Record<string, unknown>
  const decisions = Array.isArray(r.decisions)
    ? (r.decisions as unknown[]).flatMap((d): Decision[] => {
        if (!d || typeof d !== 'object') return []
        const o = d as Record<string, unknown>
        const id = str(o.id)
        const title = str(o.title).trim()
        if (!id || !title) return []
        return [{
          id,
          title,
          why: str(o.why),
          who: strList(o.who),
          decidedAt: num(o.decidedAt) ?? num(o.createdAt) ?? 0,
          status: o.status === 'superseded' || o.status === 'reverted' ? o.status : 'accepted',
          rejected: normRejected(o.rejected, id),
          source: normSource(o.source),
          tags: strList(o.tags),
          exposeToAgents: o.exposeToAgents !== false,
          syncedRules: strList(o.syncedRules),
          createdAt: num(o.createdAt) ?? 0,
          updatedAt: num(o.updatedAt) ?? 0,
        }]
      })
    : []
  const candidates = Array.isArray(r.candidates)
    ? (r.candidates as unknown[]).flatMap((c): DecisionCandidate[] => {
        if (!c || typeof c !== 'object') return []
        const o = c as Record<string, unknown>
        const title = str(o.title).trim()
        if (!str(o.id) || !title) return []
        return [{
          id: str(o.id), title, why: str(o.why), who: strList(o.who),
          rejected: normRejected(o.rejected, str(o.id)), quote: str(o.quote) || undefined,
          source: normSource(o.source), extractionId: str(o.extractionId),
        }]
      })
    : []
  const extractions = Array.isArray(r.extractions)
    ? (r.extractions as unknown[]).flatMap((e): DecisionExtraction[] => {
        if (!e || typeof e !== 'object') return []
        const o = e as Record<string, unknown>
        if (!str(o.id) || !str(o.sessionId)) return []
        return [{
          id: str(o.id), sessionId: str(o.sessionId), source: normSource(o.source),
          startedAt: num(o.startedAt) ?? 0, parsedAt: num(o.parsedAt),
          failed: o.failed === true || undefined, found: num(o.found),
        }]
      }).slice(0, 30)
    : []
  return { decisions, candidates, extractions }
}

export interface DecisionFilter {
  query: string
  status: DecisionStatus | 'all'
  source: DecisionSourceKind | 'all'
  /** days back, or null for all time */
  periodDays: number | null
}

export function filterDecisions(decisions: readonly Decision[], filter: DecisionFilter, now: number): Decision[] {
  const terms = normalizeTerms(filter.query.split(/\s+/))
  const since = filter.periodDays == null ? -Infinity : now - filter.periodDays * 86400000
  return decisions
    .filter((d) => filter.status === 'all' || d.status === filter.status)
    .filter((d) => filter.source === 'all' || d.source.kind === filter.source)
    .filter((d) => d.decidedAt >= since)
    .filter((d) => {
      if (terms.length === 0) return true
      const hay = [d.title, d.why, ...d.who, ...d.tags, ...d.rejected.map((r) => `${r.text} ${r.reason ?? ''}`), d.source.label ?? ''].join(' ')
      return terms.every((term) => matchesAnyTerm(hay, [term]))
    })
    .sort((a, b) => b.decidedAt - a.decidedAt)
}

function isoDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface LessonRule {
  rule: string
  negative: boolean
}

/**
 * Memory lessons for one decision. Only accepted decisions that are exposed
 * produce rules; superseded/reverted ones produce none (their rules get removed).
 */
export function lessonRulesFor(decision: Decision): LessonRule[] {
  if (!decision.exposeToAgents || decision.status !== 'accepted') return []
  const day = isoDay(decision.decidedAt)
  const rules: LessonRule[] = [{
    rule: `Решение (${day}): ${decision.title}${decision.why.trim() ? ` — потому что ${decision.why.trim()}` : ''}. Учитывай его и не предлагай пересматривать без новых причин.`,
    negative: false,
  }]
  for (const option of decision.rejected) {
    rules.push({
      rule: `предлагать «${option.text}» — вариант отклонён в решении «${decision.title}» (${day})${option.reason ? `: ${option.reason}` : ''}.`,
      negative: true,
    })
  }
  return rules
}

/** Diff previously synced rule texts against the wanted rules. */
export function diffLessonRules(synced: readonly string[], wanted: readonly LessonRule[]): { add: LessonRule[]; remove: string[] } {
  const wantedSet = new Set(wanted.map((r) => r.rule))
  const syncedSet = new Set(synced)
  return {
    add: wanted.filter((r) => !syncedSet.has(r.rule)),
    remove: synced.filter((rule) => !wantedSet.has(rule)),
  }
}

type TranscriptMessage = { role?: string; content?: string; isIntermediate?: boolean }

/** Compact transcript of a Rox session (user + final assistant turns), newest kept when capped. */
export function sessionTranscript(messages: readonly TranscriptMessage[] | undefined, maxChars = 24000): string {
  if (!messages) return ''
  const lines = messages
    .filter((m) => (m.role === 'user' || (m.role === 'assistant' && !m.isIntermediate)) && typeof m.content === 'string' && m.content.trim())
    .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Агент'}: ${m.content!.trim()}`)
  let text = lines.join('\n\n')
  if (text.length > maxChars) text = `…\n${text.slice(-maxChars)}`
  return text
}

/** Best-effort transcript text from a getMeeting() payload (segments with `text`). */
export function meetingTranscript(payload: unknown, maxChars = 24000): string {
  const out: string[] = []
  const visit = (v: unknown, depth: number) => {
    if (depth > 4 || !v) return
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          const seg = item as { text: string; speakerId?: string | null; speaker?: string }
          const who = seg.speaker ?? seg.speakerId
          out.push(`${who ? `${who}: ` : ''}${seg.text.trim()}`)
        } else visit(item, depth + 1)
      }
    } else if (typeof v === 'object') {
      for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
        if (key === 'summary' && typeof value === 'string' && value.trim()) out.unshift(`Итоги: ${value.trim()}`)
        else visit(value, depth + 1)
      }
    }
  }
  visit(payload, 0)
  let text = out.filter(Boolean).join('\n')
  if (text.length > maxChars) text = `…\n${text.slice(-maxChars)}`
  return text
}

export function buildExtractionPrompt(source: DecisionSource, transcript: string, language: 'ru' | 'en'): string {
  const where = source.kind === 'meeting' ? (language === 'ru' ? 'встречи' : 'meeting') : (language === 'ru' ? 'сессии' : 'session')
  const head = language === 'ru'
    ? [
        `Извлеки принятые решения из ${where} «${source.label ?? source.id ?? ''}». Только то, что действительно решили (не идеи и не вопросы).`,
        'Для каждого: что решили, почему, кто решил/участвовал, какие варианты отклонили и почему, короткая цитата-основание.',
        'Ничего не отправляй и не меняй — только прочитай текст ниже и ответь.',
        'Ответь ОДНИМ блоком ```json: {"decisions": [{"title": "…", "why": "…", "who": ["…"], "rejected": [{"text": "…", "reason": "…"}], "quote": "…"}]}. Если решений нет — {"decisions": []}.',
        '',
        '--- Текст ---',
      ]
    : [
        `Extract the decisions actually made in the ${where} “${source.label ?? source.id ?? ''}” (not ideas or open questions).`,
        'For each: what was decided, why, who decided/was involved, which options were rejected and why, a short supporting quote.',
        'Do not send or change anything — only read the text below and answer.',
        'Answer with ONE ```json block: {"decisions": [{"title": "…", "why": "…", "who": ["…"], "rejected": [{"text": "…", "reason": "…"}], "quote": "…"}]}. No decisions → {"decisions": []}.',
        '',
        '--- Text ---',
      ]
  return [...head, transcript].join('\n')
}

/** Parse extraction JSON into candidates; null = no JSON at all. */
export function parseDecisionCandidates(
  parsed: unknown,
  ctx: { extractionId: string; source: DecisionSource },
): DecisionCandidate[] | null {
  if (parsed == null || typeof parsed !== 'object') return null
  const list = Array.isArray(parsed) ? parsed : (parsed as { decisions?: unknown }).decisions
  if (!Array.isArray(list)) return null
  return list.slice(0, 20).flatMap((raw, i): DecisionCandidate[] => {
    if (!raw || typeof raw !== 'object') return []
    const o = raw as Record<string, unknown>
    const title = str(o.title).trim()
    if (!title) return []
    const id = `${ctx.extractionId}-${i}`
    return [{
      id,
      title,
      why: str(o.why).trim(),
      who: strList(o.who),
      rejected: normRejected(o.rejected, id),
      quote: str(o.quote).trim() || undefined,
      source: ctx.source,
      extractionId: ctx.extractionId,
    }]
  })
}

export function candidateToDecision(candidate: DecisionCandidate, id: string, now: number): Decision {
  return {
    id,
    title: candidate.title,
    why: candidate.why,
    who: candidate.who,
    decidedAt: now,
    status: 'accepted',
    rejected: candidate.rejected,
    source: candidate.source,
    tags: [],
    exposeToAgents: true,
    syncedRules: [],
    createdAt: now,
    updatedAt: now,
  }
}
