/**
 * Радар — pure model: topics, daily sweep bookkeeping, the sweep prompt,
 * parsing the agent's JSON digest, local keyword signals and the actions
 * (task / reply draft). No I/O (tested in __tests__/radar-model.test.ts).
 */
import { matchesAnyTerm, normalizeTerms } from '@/lib/extra-screens/text-match'

export type RadarTopicKind = 'topic' | 'competitor' | 'keyword'
export type RadarBucket = 'reaction' | 'important' | 'changed'

export interface RadarTopic {
  id: string
  label: string
  kind: RadarTopicKind
  keywords: string[]
  createdAt: number
}

export interface RadarItem {
  id: string
  title: string
  summary: string
  why?: string
  url?: string
  source: string
  topic?: string
  bucket: RadarBucket
  /** What reaction is expected (reply, decide, read…). */
  reaction?: string
  /** 'agent' = from the sweep; 'local' = keyword match in Rox data. */
  origin: 'agent' | 'local'
  at?: number
  /** Local signals link back to a Rox object. */
  ref?: { kind: 'session' | 'meeting' | 'note' | 'task'; id: string }
}

export interface RadarSweep {
  id: string
  sessionId: string
  /** Local calendar date YYYY-MM-DD the sweep belongs to. */
  date: string
  startedAt: number
  trigger: 'manual' | 'daily'
  items?: RadarItem[]
  /** Agent notes when it could not reach sources, etc. */
  notes?: string
  parsedAt?: number
  parseFailed?: boolean
}

export interface RadarData {
  topics: RadarTopic[]
  sweeps: RadarSweep[]
  dismissed: string[]
  daily: boolean
  dailyHour: number
}

export const MAX_SWEEPS = 30

export function emptyRadarData(): RadarData {
  return { topics: [], sweeps: [], dismissed: [], daily: true, dailyHour: 7 }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const BUCKETS: RadarBucket[] = ['reaction', 'important', 'changed']

export function normalizeRadarData(raw: unknown): RadarData {
  const base = emptyRadarData()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const topics = Array.isArray(r.topics)
    ? (r.topics as unknown[]).flatMap((t): RadarTopic[] => {
        if (!t || typeof t !== 'object') return []
        const o = t as Record<string, unknown>
        const label = str(o.label).trim()
        if (!label || !str(o.id)) return []
        return [{
          id: str(o.id),
          label,
          kind: o.kind === 'competitor' || o.kind === 'keyword' ? o.kind : 'topic',
          keywords: Array.isArray(o.keywords) ? (o.keywords as unknown[]).map((k) => str(k).trim()).filter(Boolean) : [],
          createdAt: num(o.createdAt) ?? 0,
        }]
      })
    : []
  const sweeps = Array.isArray(r.sweeps)
    ? (r.sweeps as unknown[]).flatMap((s): RadarSweep[] => {
        if (!s || typeof s !== 'object') return []
        const o = s as Record<string, unknown>
        if (!str(o.id) || !str(o.sessionId) || !str(o.date)) return []
        return [{
          id: str(o.id),
          sessionId: str(o.sessionId),
          date: str(o.date),
          startedAt: num(o.startedAt) ?? 0,
          trigger: o.trigger === 'daily' ? 'daily' : 'manual',
          items: Array.isArray(o.items) ? (o.items as RadarItem[]) : undefined,
          notes: str(o.notes) || undefined,
          parsedAt: num(o.parsedAt),
          parseFailed: o.parseFailed === true || undefined,
        }]
      })
    : []
  return {
    topics,
    sweeps: sweeps.slice(0, MAX_SWEEPS),
    dismissed: Array.isArray(r.dismissed) ? (r.dismissed as unknown[]).map(str).filter(Boolean).slice(-500) : [],
    daily: r.daily !== false,
    dailyHour: typeof r.dailyHour === 'number' && r.dailyHour >= 0 && r.dailyHour <= 23 ? Math.floor(r.dailyHour) : 7,
  }
}

export function localDateKey(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** The daily sweep runs once per local day, after `dailyHour`, only with topics. */
export function shouldRunDailySweep(data: RadarData, now: number): boolean {
  if (!data.daily || data.topics.length === 0) return false
  if (new Date(now).getHours() < data.dailyHour) return false
  const today = localDateKey(now)
  return !data.sweeps.some((sweep) => sweep.date === today)
}

export function latestSweep(data: RadarData): RadarSweep | undefined {
  return [...data.sweeps].sort((a, b) => b.startedAt - a.startedAt)[0]
}

function topicLine(topic: RadarTopic): string {
  const kind = topic.kind === 'competitor' ? 'конкурент' : topic.kind === 'keyword' ? 'ключевое слово' : 'тема'
  const words = topic.keywords.length ? ` — слова: ${topic.keywords.join(', ')}` : ''
  return `- [${kind}] ${topic.label}${words}`
}

export function buildRadarPrompt(topics: readonly RadarTopic[], now: number, language: 'ru' | 'en'): string {
  const since = new Date(now - 24 * 3600 * 1000).toISOString()
  const lines = language === 'ru'
    ? [
        'Сделай утренний обзор «Радар» за последние 24 часа (с ' + since + ').',
        'Источники: Лента Rox, новости и X — только через уже подключённые в этой рабочей области источники и инструменты в режиме чтения. Если источников новостей/X нет — так и напиши в notes и верни пустой список, ничего не выдумывай.',
        'Строго запрещено: отправлять сообщения, публиковать, отвечать кому-либо, менять что-либо. Только читать и суммировать.',
        'Темы:',
      ]
    : [
        'Produce the morning “Radar” digest for the last 24 hours (since ' + since + ').',
        'Sources: the Rox Feed, news and X — only via sources/tools already connected in this workspace, read-only. If there are no news/X sources, say so in notes and return an empty list; never invent items.',
        'Strictly forbidden: sending messages, posting, replying to anyone, changing anything. Read and summarise only.',
        'Topics:',
      ]
  lines.push(...topics.map(topicLine))
  lines.push('')
  lines.push(language === 'ru'
    ? 'Ответь ОДНИМ блоком ```json в формате:'
    : 'Answer with ONE ```json block shaped like:')
  lines.push('```json')
  lines.push('{"notes": "…", "items": [{"title": "…", "summary": "1–2 предложения", "why": "почему важно", "url": "https://…", "source": "X | Новости | Лента | …", "topic": "название темы", "bucket": "reaction | important | changed", "reaction": "что нужно сделать (для bucket=reaction)"}]}')
  lines.push('```')
  lines.push(language === 'ru'
    ? 'bucket: reaction — нужна реакция Марка (ответить/решить); important — важно знать; changed — что изменилось. Не больше 15 пунктов.'
    : 'bucket: reaction — Mark needs to react (reply/decide); important — worth knowing; changed — what changed. At most 15 items.')
  return lines.join('\n')
}

function hashId(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export function radarItemId(title: string, url?: string): string {
  return `rad-${hashId(`${title.trim().toLowerCase()}|${url ?? ''}`)}`
}

/**
 * Parse the agent's digest JSON. Returns null when the output has no JSON
 * (still running, refused, free text); an empty list is a valid «nothing new».
 */
export function parseRadarDigest(parsed: unknown): { items: RadarItem[]; notes?: string } | null {
  if (parsed == null) return null
  const obj = Array.isArray(parsed) ? { items: parsed } : (parsed as Record<string, unknown>)
  if (typeof obj !== 'object') return null
  const rawItems = Array.isArray((obj as { items?: unknown }).items) ? ((obj as { items: unknown[] }).items) : null
  if (!rawItems) return null
  const items: RadarItem[] = []
  const seen = new Set<string>()
  for (const raw of rawItems.slice(0, 30)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const title = str(o.title).trim()
    if (!title) continue
    const url = str(o.url).trim()
    const safeUrl = /^https?:\/\//i.test(url) ? url : undefined
    const id = radarItemId(title, safeUrl)
    if (seen.has(id)) continue
    seen.add(id)
    const bucket = BUCKETS.includes(o.bucket as RadarBucket) ? (o.bucket as RadarBucket) : 'changed'
    items.push({
      id,
      title,
      summary: str(o.summary).trim(),
      why: str(o.why).trim() || undefined,
      url: safeUrl,
      source: str(o.source).trim() || '—',
      topic: str(o.topic).trim() || undefined,
      bucket,
      reaction: bucket === 'reaction' ? str(o.reaction).trim() || undefined : undefined,
      origin: 'agent',
    })
  }
  const notes = str((obj as { notes?: unknown }).notes).trim() || undefined
  return { items, notes }
}

export interface LocalSignalSources {
  sessions: readonly { id: string; name: string; lastMessageAt?: number }[]
  meetings: readonly { id: string; title: string; at?: number }[]
  notes: readonly { id: string; title: string; updatedAt?: number }[]
}

/** Keyword matches in Rox data from the last 24 h (Лента stand-in until feed:list lands). */
export function matchLocalSignals(topics: readonly RadarTopic[], sources: LocalSignalSources, now: number): RadarItem[] {
  const since = now - 24 * 3600 * 1000
  const out: RadarItem[] = []
  for (const topic of topics) {
    const terms = normalizeTerms([topic.label, ...topic.keywords])
    const push = (kind: 'session' | 'meeting' | 'note', id: string, title: string, at: number | undefined, source: string) => {
      if (at == null || at < since || !matchesAnyTerm(title, terms)) return
      out.push({
        id: `loc-${kind}-${id}-${topic.id}`,
        title,
        summary: '',
        source,
        topic: topic.label,
        bucket: 'changed',
        origin: 'local',
        at,
        ref: { kind, id },
      })
    }
    for (const s of sources.sessions) push('session', s.id, s.name, s.lastMessageAt, 'session')
    for (const m of sources.meetings) push('meeting', m.id, m.title, m.at, 'meeting')
    for (const n of sources.notes) push('note', n.id, n.title, n.updatedAt, 'note')
  }
  return out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

export function groupDigest(items: readonly RadarItem[], dismissed: readonly string[]): Record<RadarBucket, RadarItem[]> {
  const hidden = new Set(dismissed)
  const groups: Record<RadarBucket, RadarItem[]> = { reaction: [], important: [], changed: [] }
  for (const item of items) if (!hidden.has(item.id)) groups[item.bucket].push(item)
  return groups
}

export function topicItemCount(topic: RadarTopic, items: readonly RadarItem[]): number {
  const label = topic.label.toLocaleLowerCase('ru')
  return items.filter((item) => item.topic?.toLocaleLowerCase('ru') === label).length
}

/** New-session input for a reply draft. It is only pre-filled — never sent automatically. */
export function buildReplyDraftInput(item: RadarItem, language: 'ru' | 'en'): string {
  const ctx = [item.summary, item.why].filter(Boolean).join(' ')
  if (language === 'ru') {
    return [
      `Подготовь черновик ответа на: «${item.title}»${item.url ? ` (${item.url})` : ''}.`,
      ctx ? `Контекст: ${ctx}` : '',
      'Только черновик текста в этом чате — ничего не отправляй и не публикуй.',
    ].filter(Boolean).join('\n')
  }
  return [
    `Draft a reply to: “${item.title}”${item.url ? ` (${item.url})` : ''}.`,
    ctx ? `Context: ${ctx}` : '',
    'Draft text in this chat only — do not send or post anything.',
  ].filter(Boolean).join('\n')
}

export function buildTaskFromItem(item: RadarItem): { title: string; notes: string } {
  const notes = [item.summary, item.why, item.reaction ? `Реакция: ${item.reaction}` : '', item.url ?? '', `Радар · ${item.source}`]
    .filter(Boolean)
    .join('\n')
  return { title: item.reaction ? `${item.reaction}: ${item.title}` : item.title, notes }
}
