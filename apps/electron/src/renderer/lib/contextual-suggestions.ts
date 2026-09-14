import type { LoadedSkill, Message, Session } from '../../shared/types'

export const SUGGESTION_IDLE_MS = 1_800
export const SUGGESTION_COOLDOWN_MS = 5 * 60_000
export const REUSABLE_PROCESS_MAX_AGE_MS = 30 * 60_000
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60_000

export interface CompletionSignal {
  reason?: string
  didReceiveNewFinalMessage?: boolean
  backgroundTasksAlive?: boolean
}

export interface ReusableProcess {
  id: string
  workspaceId: string
  sessionId: string
  userMessageId: string
  finalMessageId: string
  completedAt: number
}

export interface SuggestionHistory {
  seen: Record<string, number>
  lastShownAt: number
}

export interface ContextualSuggestion {
  id: string
  workspaceId: string
  sessionId: string
  kind: 'save-process' | 'apply-skill'
  skill?: LoadedSkill
}

export function isSuccessfulCompletion(event: CompletionSignal): boolean {
  return (event.reason === undefined || event.reason === 'complete')
    && event.didReceiveNewFinalMessage !== false
}

export function latestCompletedTurn(session: Session): { user: Message; final: Message; messages: Message[] } | null {
  if (session.hidden || session.isProcessing) return null
  const userIndex = session.messages.findLastIndex(message => message.role === 'user' && !message.hidden)
  if (userIndex < 0) return null
  const messages = session.messages.slice(userIndex + 1)
  if (messages.some(message => message.role === 'error' || message.isError)) return null
  const final = messages.findLast(message => message.role === 'assistant'
    && !message.hidden && !message.isIntermediate && !message.isStreaming && !message.isPending && !message.isError
    && Boolean(message.content.trim()))
  if (!final) return null
  return { user: session.messages[userIndex], final, messages }
}

/** Only fresh, completed multi-step work is a candidate; a plan is not a result. */
export function reusableProcessFromCompletion(session: Session, event: CompletionSignal, now: number): ReusableProcess | null {
  if (!isSuccessfulCompletion(event) || event.backgroundTasksAlive) return null
  const turn = latestCompletedTurn(session)
  if (!turn || turn.final.content.trim().length < 40) return null
  if (turn.messages.some(message => message.role === 'error' || message.isError || message.toolStatus === 'error')) return null
  const tools = turn.messages.filter(message => message.role === 'tool')
  if (tools.length < 2 || tools.some(message => message.toolStatus !== 'completed')) return null
  return {
    id: `save-process:${session.workspaceId}:${session.id}:${turn.final.id}`,
    workspaceId: session.workspaceId,
    sessionId: session.id,
    userMessageId: turn.user.id,
    finalMessageId: turn.final.id,
    completedAt: now,
  }
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'before', 'create', 'from', 'help', 'into', 'please', 'project', 'should', 'skill', 'that', 'their', 'them', 'these', 'this', 'using', 'want', 'when', 'with', 'your',
  'быть', 'будет', 'всего', 'давай', 'если', 'используй', 'который', 'можно', 'нужно', 'навык', 'пожалуйста', 'помоги', 'после', 'проект', 'сделай', 'этого', 'этот', 'чтобы',
])

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function meaningfulWords(text: string): Set<string> {
  return new Set(normalizeText(text).split(' ').filter(word => word.length >= 4 && !STOP_WORDS.has(word)))
}

/** Conservative local matching of the user's draft against saved skill metadata. */
export function matchingSavedSkill(draft: string, skills: LoadedSkill[]): LoadedSkill | null {
  if (draft.trim().length < 18 || /\[skill:/i.test(draft)) return null
  const normalizedDraft = ` ${normalizeText(draft)} `
  const draftWords = meaningfulWords(draft)
  let best: { skill: LoadedSkill; score: number } | null = null

  for (const skill of skills) {
    if (skill.shadowedByCraft || !/^[\w-]+$/.test(skill.slug)) continue
    const name = normalizeText(skill.metadata.name)
    const slug = normalizeText(skill.slug)
    const phraseMatch = [name, slug].some(phrase => {
      // CJK text does not require spaces between a skill name and nearby words.
      const withoutWordSpaces = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(phrase)
      return withoutWordSpaces
        ? phrase.length >= 3 && normalizedDraft.includes(phrase)
        : phrase.length >= 5 && normalizedDraft.includes(` ${phrase} `)
    })
    const nameWords = meaningfulWords(`${skill.metadata.name} ${skill.slug}`)
    const words = meaningfulWords(`${skill.metadata.name} ${skill.slug} ${skill.metadata.description}`)
    const matches = [...words].filter(word => draftWords.has(word))
    const nameMatch = matches.some(word => nameWords.has(word))
    if (!phraseMatch && !(matches.length >= 2 && nameMatch)) continue
    const score = (phraseMatch ? 10 : 0) + matches.length
    if (!best || score > best.score) best = { skill, score }
  }

  return best?.skill ?? null
}

export function selectContextualSuggestion(options: {
  session: Session | null
  process?: ReusableProcess
  draft: string
  skills: LoadedSkill[]
  active: boolean
  hasPendingRequest: boolean
  now: number
}): ContextualSuggestion | null {
  const { session, process, draft, skills, active, hasPendingRequest, now } = options
  if (!session || session.hidden || session.isProcessing || !active || hasPendingRequest) return null
  if (session.messages.some(message => message.role === 'auth-request' && message.authStatus === 'pending')) return null
  if (draft.trim()) {
    const skill = matchingSavedSkill(draft, skills)
    return skill ? {
      id: `apply-skill:${session.workspaceId}:${session.id}:${skill.slug}`,
      workspaceId: session.workspaceId,
      sessionId: session.id,
      kind: 'apply-skill',
      skill,
    } : null
  }
  if (!process || process.sessionId !== session.id || process.workspaceId !== session.workspaceId
    || now - process.completedAt > REUSABLE_PROCESS_MAX_AGE_MS) return null
  const turn = latestCompletedTurn(session)
  if (turn?.user.id !== process.userMessageId || turn.final.id !== process.finalMessageId) return null
  return { id: process.id, workspaceId: process.workspaceId, sessionId: process.sessionId, kind: 'save-process' }
}

export function canOfferSuggestion(history: SuggestionHistory, id: string, now: number): boolean {
  const seenAt = history.seen[id]
  if (seenAt !== undefined && now - seenAt < HISTORY_MAX_AGE_MS) return false
  return history.lastShownAt === 0 || now - history.lastShownAt >= SUGGESTION_COOLDOWN_MS
}

export function rememberSuggestion(history: SuggestionHistory, id: string, now: number): SuggestionHistory {
  const recent = Object.entries(history.seen).filter(([, at]) => now - at < HISTORY_MAX_AGE_MS).slice(-99)
  return { seen: { ...Object.fromEntries(recent), [id]: now }, lastShownAt: now }
}

/** Existing composer mention syntax: selection prepares a draft and never sends it. */
export function addSkillToDraft(draft: string, slug: string): string {
  if (!/^[\w-]+$/.test(slug) || /\[skill:/i.test(draft)) return draft
  return `[skill:${slug}] ${draft}`
}
