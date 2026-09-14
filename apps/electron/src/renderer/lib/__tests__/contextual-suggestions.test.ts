import { describe, expect, it } from 'bun:test'
import type { LoadedSkill, Message, Session } from '../../../shared/types'
import {
  addSkillToDraft,
  canOfferSuggestion,
  matchingSavedSkill,
  normalizeSuggestionHistory,
  rememberSuggestion,
  reusableProcessFromCompletion,
  selectContextualSuggestion,
  REUSABLE_PROCESS_MAX_AGE_MS,
  SUGGESTION_COOLDOWN_MS,
} from '../contextual-suggestions'

const now = 1_000_000
const message = (id: string, role: Message['role'], extra: Partial<Message> = {}): Message => ({
  id, role, content: 'A completed result with enough detail to preserve as a reusable process.', timestamp: now, ...extra,
})
const session = (extra: Partial<Session> = {}): Session => ({
  id: 'chat-1', workspaceId: 'workspace-1', workspaceName: 'Workspace', lastMessageAt: now, isProcessing: false,
  messages: [
    message('user-1', 'user'),
    message('tool-1', 'tool', { toolName: 'Read', toolStatus: 'completed' }),
    message('tool-2', 'tool', { toolName: 'Bash', toolStatus: 'completed' }),
    message('final-1', 'assistant'),
  ],
  ...extra,
})
const skill = (extra: Partial<LoadedSkill> = {}): LoadedSkill => ({
  slug: 'code-review', source: 'workspace', path: '/workspace/skills/code-review', content: '',
  metadata: { name: 'Code review', description: 'Review changes for bugs, regressions, and missing tests.' },
  ...extra,
})

describe('successful process suggestions', () => {
  it('recognizes a fresh final answer after completed tool work', () => {
    const result = reusableProcessFromCompletion(session(), { reason: 'complete', didReceiveNewFinalMessage: true }, now)
    expect(result?.finalMessageId).toBe('final-1')
    expect(result?.userMessageId).toBe('user-1')
  })

  it('does not mistake an interrupted, failed, timed-out, or replayed turn for success', () => {
    for (const reason of ['interrupted', 'error', 'timeout']) {
      expect(reusableProcessFromCompletion(session(), { reason }, now)).toBeNull()
    }
    expect(reusableProcessFromCompletion(session(), { didReceiveNewFinalMessage: false }, now)).toBeNull()
    expect(reusableProcessFromCompletion(session(), { backgroundTasksAlive: true }, now)).toBeNull()
  })

  it('does not suggest preserving a plan, unfinished tool, error, or a trivial answer', () => {
    const base = session()
    const variants = [
      { hidden: true },
      { isProcessing: true },
      { messages: [base.messages[0], message('final', 'assistant')] },
      { messages: [...base.messages.slice(0, -1), message('plan', 'plan')] },
      { messages: [...base.messages.slice(0, -1), message('partial', 'assistant', { isStreaming: true })] },
      { messages: [...base.messages, message('error', 'error')] },
      { messages: base.messages.map(m => m.id === 'tool-2' ? { ...m, toolStatus: 'executing' as const } : m) },
      { messages: base.messages.map(m => m.id === 'tool-2' ? { ...m, toolStatus: 'error' as const } : m) },
      { messages: [...base.messages.slice(0, -1), message('short', 'assistant', { content: 'Done' })] },
    ]
    for (const variant of variants) expect(reusableProcessFromCompletion(session(variant), {}, now)).toBeNull()
  })

  it('waits for an idle, focused chat with an empty draft and no permission request', () => {
    const base = session()
    const process = reusableProcessFromCompletion(base, {}, now)!
    const options = { session: base, process, draft: '', skills: [], active: true, hasPendingRequest: false, now }
    expect(selectContextualSuggestion(options)?.kind).toBe('save-process')
    expect(selectContextualSuggestion({ ...options, active: false })).toBeNull()
    expect(selectContextualSuggestion({ ...options, hasPendingRequest: true })).toBeNull()
    expect(selectContextualSuggestion({ ...options, draft: 'I am editing my next request' })).toBeNull()
    expect(selectContextualSuggestion({ ...options, session: session({ isProcessing: true }) })).toBeNull()
    expect(selectContextualSuggestion({ ...options, session: session({
      messages: [...base.messages, message('auth', 'auth-request', { authStatus: 'pending' })],
    }) })).toBeNull()
  })

  it('cannot reuse a result from a previous user turn, workspace, or expired context', () => {
    const base = session()
    const process = reusableProcessFromCompletion(base, {}, now)!
    const options = { session: base, process, draft: '', skills: [], active: true, hasPendingRequest: false, now }
    expect(selectContextualSuggestion({ ...options, now: now + REUSABLE_PROCESS_MAX_AGE_MS + 1 })).toBeNull()
    expect(selectContextualSuggestion({ ...options, session: session({ workspaceId: 'other' }) })).toBeNull()
    expect(selectContextualSuggestion({ ...options, session: session({ messages: [...base.messages, message('new-user', 'user')] }) })).toBeNull()
    expect(selectContextualSuggestion({ ...options, session: session({ messages: [...base.messages, message('new-error', 'error')] }) })).toBeNull()
  })
})

describe('saved skill suggestions', () => {
  it('matches meaningful metadata and rejects weak or unrelated overlap', () => {
    expect(matchingSavedSkill('Please do a code review of these changes.', [skill()])?.slug).toBe('code-review')
    expect(matchingSavedSkill('Review these changes and check the missing tests.', [skill()])?.slug).toBe('code-review')
    expect(matchingSavedSkill('Write a project plan for the new website.', [skill()])).toBeNull()
    expect(matchingSavedSkill('Update the code and deploy this project.', [skill()])).toBeNull()
  })

  it('supports Russian and CJK names without scanning private skill content', () => {
    const russian = skill({ metadata: { name: 'Проверка типов', description: 'Проверить типы TypeScript' } })
    const chinese = skill({ metadata: { name: '代码审查', description: '检查代码变更' } })
    expect(matchingSavedSkill('Нужна проверка типов перед выпуском новой версии.', [russian])).toBe(russian)
    expect(matchingSavedSkill('请对这个改动执行代码审查，并检查所有的边界条件。', [chinese])).toBe(chinese)
    expect(matchingSavedSkill('Do a code review of this implementation.', [skill({
      slug: 'research', metadata: { name: 'Research', description: 'Find relevant sources' }, content: 'Code review',
    })])).toBeNull()
  })

  it('does not override an explicit skill or offer a shadowed skill', () => {
    expect(matchingSavedSkill('[skill:other] Please do a code review.', [skill()])).toBeNull()
    expect(matchingSavedSkill('Please do a code review of these changes.', [skill({ shadowedByCraft: true })])).toBeNull()
    expect(matchingSavedSkill('Please do a code review of these changes.', [skill({ slug: '../invalid' })])).toBeNull()
  })

  it('adds the real mention syntax while preserving the entire draft', () => {
    const draft = 'Review these changes\n\nKeep the existing behavior.  '
    expect(addSkillToDraft(draft, 'code-review')).toBe(`[skill:code-review] ${draft}`)
    expect(addSkillToDraft('[skill:other] keep this', 'code-review')).toBe('[skill:other] keep this')
    expect(addSkillToDraft(draft, '../invalid')).toBe(draft)
  })
})

describe('suggestion frequency', () => {
  it('recovers from old or malformed storage without crashing or blocking suggestions forever', () => {
    for (const stored of [null, false, 'old', [], {}, { seen: null }, { seen: ['old'] }]) {
      expect(canOfferSuggestion(stored, 'first', now)).toBe(true)
      expect(rememberSuggestion(stored, 'first', now)).toEqual({ seen: { first: now }, lastShownAt: now })
    }
    const damaged = { seen: { first: now + 86_400_000, second: 'yesterday', third: -1 }, lastShownAt: Infinity }
    expect(normalizeSuggestionHistory(damaged, now)).toEqual({ seen: {}, lastShownAt: 0 })
    expect(canOfferSuggestion(damaged, 'first', now)).toBe(true)
  })

  it('evicts the oldest timestamps and retains an existing suggestion refreshed out of insertion order', () => {
    const seen = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`id-${index}`, now - index]))
    const history = rememberSuggestion({ seen, lastShownAt: now - 1 }, 'id-119', now)
    expect(Object.keys(history.seen)).toHaveLength(100)
    expect(history.seen['id-0']).toBe(now)
    expect(history.seen['id-119']).toBe(now)
    expect(history.seen['id-118']).toBeUndefined()
  })

  it('remembers an offered/dismissed suggestion and observes the cooldown for other suggestions', () => {
    const empty = { seen: {}, lastShownAt: 0 }
    expect(canOfferSuggestion(empty, 'first', now)).toBe(true)
    const shown = rememberSuggestion(empty, 'first', now)
    expect(canOfferSuggestion(shown, 'first', now + SUGGESTION_COOLDOWN_MS)).toBe(false)
    expect(canOfferSuggestion(shown, 'second', now + 1)).toBe(false)
    expect(canOfferSuggestion(shown, 'second', now + SUGGESTION_COOLDOWN_MS)).toBe(true)
  })

  it('bounds persisted history without recording content', () => {
    let history = { seen: {}, lastShownAt: 0 }
    for (let i = 0; i < 120; i++) history = rememberSuggestion(history, `id-${i}`, now + i)
    expect(Object.keys(history.seen)).toHaveLength(100)
    expect(Object.keys(history)).toEqual(['seen', 'lastShownAt'])
  })
})
