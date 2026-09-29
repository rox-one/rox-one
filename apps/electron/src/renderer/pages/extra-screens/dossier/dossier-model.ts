/**
 * Досье — pure model: entity cards, aggregation of touches across Rox
 * sources, «before the call» summary and the agent brief prompt.
 * No I/O here (tested in __tests__/dossier-model.test.ts).
 */
import { matchesAnyTerm, normalizeTerms } from '@/lib/extra-screens/text-match'

export type DossierKind = 'person' | 'company'

export interface DossierPromise {
  id: string
  text: string
  /** mine = I promised them; theirs = they promised me */
  direction: 'mine' | 'theirs'
  done: boolean
  createdAt: number
}

export interface DossierEntity {
  id: string
  name: string
  kind: DossierKind
  org?: string
  aliases: string[]
  notes: string
  promises: DossierPromise[]
  briefSessionId?: string
  createdAt: number
  updatedAt: number
}

export interface DossierData {
  entities: DossierEntity[]
}

export interface SessionSource {
  id: string
  name: string
  lastMessageAt?: number
  hasUnread?: boolean
  /** Messenger platform when the session is bound to Telegram/WhatsApp/… */
  messenger?: string
}
export interface MeetingSource {
  id: string
  title: string
  at?: number
}
export interface TaskSource {
  id: string
  title: string
  notes?: string
  open: boolean
  dueAt?: number
  createdAt?: number
}
export interface NoteSource {
  id: string
  title: string
  updatedAt?: number
}
export interface FeedSource {
  id: string
  title: string
  at?: number
  summary?: string
  author?: string
  sourceTitle?: string
}

export interface DossierSources {
  sessions: readonly SessionSource[]
  meetings: readonly MeetingSource[]
  tasks: readonly TaskSource[]
  notes: readonly NoteSource[]
  /** null = the feed aggregator is not available (honest empty state). */
  feed: readonly FeedSource[] | null
}

export type TouchKind = 'session' | 'messenger' | 'meeting' | 'task' | 'note' | 'feed'

export interface DossierTouch {
  kind: TouchKind
  id: string
  title: string
  at: number | null
  /** Extra hint: messenger platform, «open task», due date… */
  hint?: string
}

export interface DossierSummary {
  touches: DossierTouch[]
  lastTouchAt: number | null
  touches30d: number
  openTasks: TaskSource[]
  unreadSessions: SessionSource[]
  promisesMine: DossierPromise[]
  promisesTheirs: DossierPromise[]
  promisesDone: DossierPromise[]
  feedAvailable: boolean
}

const DAY = 24 * 60 * 60 * 1000

export function emptyDossierData(): DossierData {
  return { entities: [] }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Tolerant parser for the persisted payload (unknown → valid DossierData). */
export function normalizeDossierData(raw: unknown): DossierData {
  if (!raw || typeof raw !== 'object') return emptyDossierData()
  const list = Array.isArray((raw as { entities?: unknown }).entities) ? (raw as { entities: unknown[] }).entities : []
  const entities: DossierEntity[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = asString(r.name).trim()
    const id = asString(r.id)
    if (!name || !id) continue
    const promises = Array.isArray(r.promises)
      ? (r.promises as unknown[]).flatMap((p): DossierPromise[] => {
          if (!p || typeof p !== 'object') return []
          const pr = p as Record<string, unknown>
          const text = asString(pr.text).trim()
          if (!text) return []
          return [{
            id: asString(pr.id) || `p-${text.length}-${asNumber(pr.createdAt, 0)}`,
            text,
            direction: pr.direction === 'theirs' ? 'theirs' : 'mine',
            done: pr.done === true,
            createdAt: asNumber(pr.createdAt, 0),
          }]
        })
      : []
    entities.push({
      id,
      name,
      kind: r.kind === 'company' ? 'company' : 'person',
      org: asString(r.org).trim() || undefined,
      aliases: Array.isArray(r.aliases) ? (r.aliases as unknown[]).map((a) => asString(a).trim()).filter(Boolean) : [],
      notes: asString(r.notes),
      promises,
      briefSessionId: asString(r.briefSessionId) || undefined,
      createdAt: asNumber(r.createdAt, 0),
      updatedAt: asNumber(r.updatedAt, 0),
    })
  }
  return { entities }
}

export function entityTerms(entity: Pick<DossierEntity, 'name' | 'aliases'>): string[] {
  return normalizeTerms([entity.name, ...entity.aliases])
}

export function buildDossierSummary(entity: DossierEntity, sources: DossierSources, now: number): DossierSummary {
  const terms = entityTerms(entity)
  const touches: DossierTouch[] = []
  const unreadSessions: SessionSource[] = []
  for (const session of sources.sessions) {
    if (!matchesAnyTerm(session.name, terms)) continue
    touches.push({
      kind: session.messenger ? 'messenger' : 'session',
      id: session.id,
      title: session.name,
      at: session.lastMessageAt ?? null,
      hint: session.messenger,
    })
    if (session.hasUnread) unreadSessions.push(session)
  }
  for (const meeting of sources.meetings) {
    if (matchesAnyTerm(meeting.title, terms)) {
      touches.push({ kind: 'meeting', id: meeting.id, title: meeting.title, at: meeting.at ?? null })
    }
  }
  const openTasks: TaskSource[] = []
  for (const task of sources.tasks) {
    if (!matchesAnyTerm(`${task.title}\n${task.notes ?? ''}`, terms)) continue
    touches.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      at: task.dueAt ?? task.createdAt ?? null,
      hint: task.open ? 'open' : 'done',
    })
    if (task.open) openTasks.push(task)
  }
  for (const note of sources.notes) {
    // Notes come pre-filtered by full-text search; the title check keeps
    // unrelated rows out when a caller passes the whole note list.
    touches.push({ kind: 'note', id: note.id, title: note.title, at: note.updatedAt ?? null })
  }
  for (const item of sources.feed ?? []) {
    if (matchesAnyTerm([item.title, item.summary, item.author].filter(Boolean).join(' '), terms)) {
      touches.push({ kind: 'feed', id: item.id, title: item.title, at: item.at ?? null, hint: item.sourceTitle })
    }
  }
  touches.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const dated = touches.filter((touch) => touch.at != null && touch.at <= now + DAY)
  const lastTouchAt = dated.length ? Math.max(...dated.map((touch) => touch.at as number)) : null
  const touches30d = dated.filter((touch) => (touch.at as number) >= now - 30 * DAY).length
  return {
    touches,
    lastTouchAt,
    touches30d,
    openTasks,
    unreadSessions,
    promisesMine: entity.promises.filter((p) => !p.done && p.direction === 'mine'),
    promisesTheirs: entity.promises.filter((p) => !p.done && p.direction === 'theirs'),
    promisesDone: entity.promises.filter((p) => p.done),
    feedAvailable: sources.feed !== null,
  }
}

/** Last-touch timestamp per entity for list sorting (sessions/meetings/tasks only; cheap). */
export function lastTouchFor(entity: DossierEntity, sources: Omit<DossierSources, 'notes'>, now: number): { last: number | null; count30d: number } {
  const summary = buildDossierSummary(entity, { ...sources, notes: [] }, now)
  return { last: summary.lastTouchAt, count30d: summary.touches30d }
}

export function sortEntitiesByLastTouch<T extends { entity: DossierEntity; last: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = (b.last ?? 0) - (a.last ?? 0)
    if (diff !== 0) return diff
    return a.entity.name.localeCompare(b.entity.name, 'ru')
  })
}

export function filterEntities(entities: readonly DossierEntity[], query: string, kind: DossierKind | 'all'): DossierEntity[] {
  const terms = normalizeTerms([query])
  return entities.filter((entity) => {
    if (kind !== 'all' && entity.kind !== kind) return false
    if (terms.length === 0) return true
    return matchesAnyTerm([entity.name, entity.org ?? '', ...entity.aliases].join('\n'), terms)
  })
}

/** Messenger channels that are not yet in the dossier (suggestions). */
export function suggestContacts(
  bindings: readonly { channelName?: string; platform: string; sessionId: string }[],
  entities: readonly DossierEntity[],
): { name: string; platform: string; sessionId: string }[] {
  const known = entities.flatMap((entity) => entityTerms(entity))
  const seen = new Set<string>()
  const out: { name: string; platform: string; sessionId: string }[] = []
  for (const binding of bindings) {
    const name = binding.channelName?.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase('ru')
    if (seen.has(key)) continue
    seen.add(key)
    if (matchesAnyTerm(name, known)) continue
    out.push({ name, platform: binding.platform, sessionId: binding.sessionId })
  }
  return out
}

export function initials(name: string): string {
  const parts = name.replace(/[@()]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('ru')
  return (parts[0][0] + parts[1][0]).toLocaleUpperCase('ru')
}

function fmtDate(ts: number | null): string {
  if (ts == null) return '—'
  return new Date(ts).toISOString().slice(0, 10)
}

/**
 * Prompt for the «before the call» agent brief. The agent works in the
 * read-only `safe` mode and is told explicitly not to contact anyone.
 */
export function buildBriefPrompt(entity: DossierEntity, summary: DossierSummary, language: 'ru' | 'en'): string {
  const lines: string[] = []
  const touches = summary.touches.slice(0, 25).map((touch) => `- [${touch.kind}] ${fmtDate(touch.at)} · ${touch.title}${touch.hint ? ` (${touch.hint})` : ''}`)
  const promises = [
    ...summary.promisesMine.map((p) => `- я обещал: ${p.text}`),
    ...summary.promisesTheirs.map((p) => `- мне обещали: ${p.text}`),
  ]
  const tasks = summary.openTasks.map((task) => `- ${task.title}${task.dueAt ? ` (до ${fmtDate(task.dueAt)})` : ''}`)
  if (language === 'ru') {
    lines.push(`Подготовь короткий бриф перед созвоном с «${entity.name}»${entity.org ? ` (${entity.org})` : ''}.`)
    lines.push('Используй только контекст ниже и доступные тебе в режиме чтения сессии/заметки Rox. Ничего никому не отправляй и не пиши наружу.')
    lines.push('Формат: 1) Кто это и где мы остановились; 2) Что обещано (мной и мне); 3) Что висит / риски; 4) 2–3 вопроса или предложения для созвона. До 150 слов.')
  } else {
    lines.push(`Prepare a short pre-call brief for “${entity.name}”${entity.org ? ` (${entity.org})` : ''}.`)
    lines.push('Use only the context below and Rox sessions/notes you can read. Do not send or post anything to anyone.')
    lines.push('Format: 1) Who and where we left off; 2) What was promised (by me and to me); 3) What is pending / risks; 4) 2–3 questions or proposals for the call. Under 150 words.')
  }
  lines.push('')
  lines.push(`Алиасы: ${entity.aliases.join(', ') || '—'}`)
  if (entity.notes.trim()) lines.push(`Заметки: ${entity.notes.trim()}`)
  lines.push(`Касания (${summary.touches.length}):`, ...(touches.length ? touches : ['- нет']))
  lines.push('Обещания:', ...(promises.length ? promises : ['- нет']))
  lines.push('Открытые задачи:', ...(tasks.length ? tasks : ['- нет']))
  return lines.join('\n')
}
