/**
 * Встречи — pure view model over local meetings (lists, buckets, groups,
 * transcript search, summary prompt/parse). No I/O.
 */
import type { LocalMeeting, LocalTranscriptSegment } from '../../../shared/meetings-local'
import { planMeetingActions, type MeetingProfileId } from '@rox/shared/meeting-agents/browser'

export type LocalBucket = 'all' | 'today' | 'upcoming' | 'past' | 'live' | 'needsAction'

export function meetingTime(m: Pick<LocalMeeting, 'startedAt' | 'scheduledAt' | 'createdAt'>): number {
  return m.startedAt ?? m.scheduledAt ?? m.createdAt
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isLiveMeeting(m: Pick<LocalMeeting, 'status'>): boolean {
  return m.status === 'recording' || m.status === 'paused'
}

export function isUpcoming(m: Pick<LocalMeeting, 'status' | 'scheduledAt'>, now: number): boolean {
  return m.status === 'planned' && (m.scheduledAt ?? 0) > now
}

export function openActionCount(m: Pick<LocalMeeting, 'actions'>): number {
  return m.actions.filter((a) => !a.done && !a.taskId).length
}

export function needsAction(m: LocalMeeting): boolean {
  if (m.audio && (m.transcript.status === 'failed' || m.transcript.status === 'unavailable')) return true
  return openActionCount(m) > 0
}

export function inLocalBucket(m: LocalMeeting, bucket: LocalBucket, now: number): boolean {
  switch (bucket) {
    case 'all': return true
    case 'today': return startOfDay(meetingTime(m)) === startOfDay(now)
    case 'upcoming': return isUpcoming(m, now)
    case 'past': return !isLiveMeeting(m) && !isUpcoming(m, now)
    case 'live': return isLiveMeeting(m)
    case 'needsAction': return needsAction(m)
  }
}

export function localBucketCounts(list: readonly LocalMeeting[], now: number): Record<LocalBucket, number> {
  const out: Record<LocalBucket, number> = { all: 0, today: 0, upcoming: 0, past: 0, live: 0, needsAction: 0 }
  for (const m of list) {
    for (const b of Object.keys(out) as LocalBucket[]) if (inLocalBucket(m, b, now)) out[b] += 1
  }
  return out
}

export type LocalGroupKind = 'now' | 'planned' | 'today' | 'yesterday' | 'day'
export interface LocalGroup {
  key: string
  kind: LocalGroupKind
  day?: number
  items: LocalMeeting[]
}

/** Live first, then upcoming (soonest first), then by day (newest first). */
export function groupLocalMeetings(list: readonly LocalMeeting[], now: number): LocalGroup[] {
  const live = list.filter(isLiveMeeting)
  const planned = list.filter((m) => isUpcoming(m, now)).sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0))
  const rest = list.filter((m) => !isLiveMeeting(m) && !isUpcoming(m, now)).sort((a, b) => meetingTime(b) - meetingTime(a))
  const groups: LocalGroup[] = []
  if (live.length) groups.push({ key: 'now', kind: 'now', items: live })
  if (planned.length) groups.push({ key: 'planned', kind: 'planned', items: planned })
  const today = startOfDay(now)
  const yesterday = startOfDay(today - 1)
  const byDay = new Map<number, LocalMeeting[]>()
  for (const m of rest) {
    const day = startOfDay(meetingTime(m))
    byDay.set(day, [...(byDay.get(day) ?? []), m])
  }
  for (const [day, items] of byDay) {
    const kind: LocalGroupKind = day === today ? 'today' : day === yesterday ? 'yesterday' : 'day'
    groups.push({ key: `d${day}`, kind, day, items })
  }
  return groups
}

export function normalizeQuery(q: string): string[] {
  return q.toLowerCase().split(/\s+/).map((s) => s.trim()).filter(Boolean)
}

export function textMatches(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const hay = text.toLowerCase()
  return terms.every((t) => hay.includes(t))
}

export function meetingMatches(m: LocalMeeting, terms: readonly string[], transcriptText?: string): boolean {
  if (terms.length === 0) return true
  const hay = [m.title, m.participants.join(' '), m.notes, m.summary?.text ?? '', m.actions.map((a) => a.text).join(' '), m.documents.map((d) => d.name).join(' '), transcriptText ?? ''].join('\n')
  return textMatches(hay, terms)
}

export function filterSegments(segments: readonly LocalTranscriptSegment[], query: string): LocalTranscriptSegment[] {
  const terms = normalizeQuery(query)
  return terms.length ? segments.filter((s) => textMatches(s.text, terms)) : [...segments]
}

/** Index of the segment playing at `ms` (last segment that started at or before it). */
export function activeSegmentIndex(segments: readonly LocalTranscriptSegment[], ms: number): number {
  let found = -1
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i]!.startMs <= ms) found = i
    else break
  }
  return found
}

export function transcriptPlainText(segments: readonly LocalTranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ')
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export interface SummaryExtraction {
  summary: string
  summarySourceSegmentIds: string[]
  decisions: Array<{ title: string; why: string; who: string[]; sourceSegmentIds: string[] }>
  actions: Array<{ text: string; sourceSegmentIds: string[] }>
  questions: Array<{ text: string; sourceSegmentIds: string[] }>
}

export function buildSummaryPrompt(input: {
  title: string
  participants: readonly string[]
  segments: readonly Pick<LocalTranscriptSegment, 'id' | 'startMs' | 'endMs' | 'text'>[]
  language: 'ru' | 'en'
  recipeId?: MeetingProfileId
  slash?: string
}): string {
  const transcript = input.segments
    .map((s) => `[segmentId=${s.id} ${formatDuration(s.startMs)}–${formatDuration(s.endMs)}] ${s.text}`)
    .join('\n')
  const clipped = transcript.length > 30000 ? `…\n${transcript.slice(-30000)}` : transcript
  const head = input.language === 'ru'
    ? [
        `Подведи итоги встречи «${input.title}»${input.participants.length ? ` (участники: ${input.participants.join(', ')})` : ''} по транскрипту ниже.`,
        'Ничего не отправляй и не меняй — только прочитай и ответь.',
        'Ответь ОДНИМ блоком ```json: {"summary":"3–6 предложений","summarySourceSegmentIds":["id"],"decisions":[{"title":"что решили","why":"почему","who":["кто"],"sourceSegmentIds":["id"]}],"actions":[{"text":"конкретное действие — кто, до когда","sourceSegmentIds":["id"]}],"questions":[{"text":"открытый вопрос","sourceSegmentIds":["id"]}]}.',
        'Каждый пункт обязан ссылаться хотя бы на один существующий segmentId из транскрипта. Не выдумывай ID, решения, действия или вопросы; если данных нет — используй пустые списки и пустое summary.',
        '',
        '--- Транскрипт ---',
      ]
    : [
        `Summarize the meeting “${input.title}”${input.participants.length ? ` (participants: ${input.participants.join(', ')})` : ''} from the transcript below.`,
        'Do not send or change anything — only read and answer.',
        'Answer with ONE ```json block: {"summary":"3–6 sentences","summarySourceSegmentIds":["id"],"decisions":[{"title":"what was decided","why":"why","who":["who"],"sourceSegmentIds":["id"]}],"actions":[{"text":"concrete action — who, by when","sourceSegmentIds":["id"]}],"questions":[{"text":"open question","sourceSegmentIds":["id"]}]}.',
        'Every item must cite at least one existing transcript segmentId. Never invent IDs, decisions, actions, or questions; use empty lists and an empty summary when evidence is absent.',
        '',
        '--- Transcript ---',
      ]
  const profile = input.recipeId || input.slash
    ? planMeetingActions({ meetingId: 'analysis', recipeId: input.recipeId, slash: input.slash }, 0)
    : null
  const profileInstructions = profile ? [
    `Analysis profile: ${profile.recipeId}; playbook: ${profile.playbook}; profile schema: ${profile.outputSchemaId}.`,
    `Role perspectives: ${profile.jobs.map(job => job.roleId).join(', ')}. Requested outputs: ${profile.outputs.join(', ')}.`,
    'Use these perspectives to prioritize the transcript-backed analysis. Preserve the JSON shape below. Propose only; do not create tasks, notes, knowledge changes, CRM updates, or external sends.',
  ] : []
  return [...profileInstructions, ...head, clipped].join('\n')
}

export function parseSummaryExtraction(parsed: unknown, allowedSegmentIds: readonly string[]): SummaryExtraction | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const allowed = new Set(allowedSegmentIds)
  const citations = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && allowed.has(id)))]
    : []
  const summarySourceSegmentIds = citations(o.summarySourceSegmentIds)
  const summary = summarySourceSegmentIds.length && typeof o.summary === 'string' ? o.summary.trim() : ''
  const decisions = Array.isArray(o.decisions)
    ? o.decisions.flatMap((d) => {
        if (!d || typeof d !== 'object') return []
        const r = d as Record<string, unknown>
        const title = typeof r.title === 'string' ? r.title.trim() : ''
        const sourceSegmentIds = citations(r.sourceSegmentIds)
        if (!title || sourceSegmentIds.length === 0) return []
        return [{
          title,
          why: typeof r.why === 'string' ? r.why.trim() : '',
          who: Array.isArray(r.who) ? r.who.filter((w): w is string => typeof w === 'string' && !!w.trim()).map((w) => w.trim()) : [],
          sourceSegmentIds,
        }]
      }).slice(0, 20)
    : []
  const citedTextItems = (value: unknown): Array<{ text: string; sourceSegmentIds: string[] }> => Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const r = item as Record<string, unknown>
        const text = typeof r.text === 'string' ? r.text.trim() : ''
        const sourceSegmentIds = citations(r.sourceSegmentIds)
        return text && sourceSegmentIds.length ? [{ text, sourceSegmentIds }] : []
      }).slice(0, 30)
    : []
  const actions = citedTextItems(o.actions)
  const questions = citedTextItems(o.questions)
  const explicitlyEmpty = o.summary === '' && Array.isArray(o.summarySourceSegmentIds) && o.summarySourceSegmentIds.length === 0
    && Array.isArray(o.decisions) && o.decisions.length === 0 && Array.isArray(o.actions) && o.actions.length === 0 && Array.isArray(o.questions) && o.questions.length === 0
  if (!summary && decisions.length === 0 && actions.length === 0 && questions.length === 0 && !explicitlyEmpty) return null
  return { summary, summarySourceSegmentIds, decisions, actions, questions }
}
