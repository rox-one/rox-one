/**
 * W1-15 (#1512) acceptance — agent-panel context contract and the §18.3
 * privacy rules, including the required negatives:
 *
 * - a private local note is never auto-attached;
 * - another user's DM is never auto-attached;
 * - a restricted ref is redacted (and a secret one is dropped outright).
 */
import { describe, expect, it } from 'bun:test'
import {
  AGENT_CONTEXT_MAX_REFS,
  AGENT_CONTEXT_MAX_TOKENS,
  AGENT_EXCERPT_MAX_CHARS,
  FALLBACK_QUICK_ACTION_KEYS,
  MAX_QUICK_ACTIONS,
  MAX_VISIBLE_QUICK_ACTIONS,
  consentCandidates,
  contextForDispatch,
  contextGroupRefs,
  cutExcerpt,
  estimateContextTokens,
  fallbackQuickActions,
  fallbackSurfaceContext,
  filterAutoAttach,
  fitContextBudget,
  mayAutoAttachRef,
  normalizeContextSnapshot,
  redactExpandedRefs,
  type AutoAttachFacts,
  type ExpandedContextRef,
  type SurfaceContext,
} from '../context.ts'

const ref = (kind: string, id: string) => ({ kind: kind as never, id })

const ALLOW: AutoAttachFacts = {
  isFocus: false,
  isPrivateLocalNote: false,
  isDirectMessage: false,
  isOpenDirectMessage: false,
  canRead: true,
  explicitlyAttached: false,
}

const context = (over: Partial<SurfaceContext> = {}): SurfaceContext => ({
  v: 1,
  workspaceId: 'w1',
  surface: 'docs',
  route: 'rox://docs/note:n1',
  title: 'Q4 план',
  locale: 'ru',
  timeZone: 'Europe/Moscow',
  consent: { privateRefs: [] },
  locked: [],
  ...over,
})

describe('W1-15 §18.3 rule 1 — auto-attach', () => {
  it('never attaches a private local note that is not the focus', () => {
    expect(mayAutoAttachRef({ ...ALLOW, isPrivateLocalNote: true })).toBe(false)
    // …not even as the visible-set neighbour, and not as the selection.
    const visible = [ref('note', 'private-1'), ref('note', 'shared-2')]
    const kept = filterAutoAttach(visible, (candidate) => ({
      ...ALLOW,
      isPrivateLocalNote: candidate.id === 'private-1',
    }))
    expect(kept.map((item) => item.id)).toEqual(['shared-2'])
  })

  it('still attaches the focused private note — the user is looking at it', () => {
    expect(mayAutoAttachRef({ ...ALLOW, isPrivateLocalNote: true, isFocus: true })).toBe(true)
  })

  it('never attaches a DM other than the open one', () => {
    expect(mayAutoAttachRef({ ...ALLOW, isDirectMessage: true })).toBe(false)
    expect(mayAutoAttachRef({ ...ALLOW, isDirectMessage: true, isOpenDirectMessage: true })).toBe(true)
    const kept = filterAutoAttach([ref('channel', 'dm-a'), ref('channel', 'dm-b'), ref('channel', 'group-c')], (candidate) => ({
      ...ALLOW,
      isDirectMessage: candidate.id !== 'group-c',
      isOpenDirectMessage: candidate.id === 'dm-a',
    }))
    expect(kept.map((item) => item.id)).toEqual(['dm-a', 'group-c'])
  })

  it('never attaches a ref the user cannot read, even when it was attached explicitly', () => {
    expect(mayAutoAttachRef({ ...ALLOW, canRead: false })).toBe(false)
    expect(mayAutoAttachRef({ ...ALLOW, canRead: false, explicitlyAttached: true })).toBe(false)
  })

  it('keeps input order and de-duplicates', () => {
    const kept = filterAutoAttach([ref('task', 't1'), ref('task', 't1'), ref('goal', 'g1')], () => ALLOW)
    expect(kept.map((item) => item.id)).toEqual(['t1', 'g1'])
  })

  it('offers sensitive refs as consent chips instead of attaching or dropping them', () => {
    const { attachable, needsConsent } = consentCandidates(
      [ref('note', 'private-1'), ref('channel', 'dm-b'), ref('task', 't1'), ref('note', 'secret-9')],
      (candidate) => ({
        ...ALLOW,
        isPrivateLocalNote: candidate.id === 'private-1',
        isDirectMessage: candidate.id === 'dm-b',
        canRead: candidate.id !== 'secret-9',
      }),
    )
    expect(attachable.map((item) => item.id)).toEqual(['t1'])
    expect(needsConsent).toEqual([
      { ref: ref('note', 'private-1'), kind: 'private-local-note' },
      { ref: ref('channel', 'dm-b'), kind: 'direct-message' },
    ])
    // An unreadable ref is not even offered as a chip — a chip would leak its existence.
    expect(needsConsent.some((entry) => entry.ref.id === 'secret-9')).toBe(false)
  })
})

describe('W1-15 §18.3 rule 2 — excerpts', () => {
  it('cuts at 2,000 characters at a block boundary', () => {
    const paragraph = `${'а'.repeat(1500)}\n\n${'б'.repeat(1500)}`
    const cut = cutExcerpt(paragraph)
    expect(cut.length).toBeLessThanOrEqual(AGENT_EXCERPT_MAX_CHARS)
    expect(cut).toBe('а'.repeat(1500))
  })

  it('falls back to a whitespace boundary, then to a hard cut', () => {
    const words = Array.from({ length: 800 }, (_, index) => `w${index}`).join(' ')
    const cut = cutExcerpt(words, 40)
    expect(cut.length).toBeLessThanOrEqual(40)
    expect(cut.endsWith(' ')).toBe(false)
    expect(cut.startsWith('w0 ')).toBe(true)
    // The cut ends exactly where the next word would start.
    expect(words[cut.length]).toBe(' ')
    const unbroken = 'x'.repeat(5000)
    expect(cutExcerpt(unbroken, 64)).toHaveLength(64)
    expect(cutExcerpt('short', 100)).toBe('short')
    expect(cutExcerpt('anything', 0)).toBe('')
  })
})

describe('W1-15 §18.3 rule 3 — the stored snapshot is what the agent saw', () => {
  it('caps selections, visible sets and locked chips at 50 refs and cuts the excerpt', () => {
    const many = Array.from({ length: 80 }, (_, index) => ref('task', `t${index}`))
    const snapshot = normalizeContextSnapshot(context({
      selection: many,
      visible: [...many, ref('task', 't0')],
      locked: many,
      consent: { privateRefs: many },
      textSelection: { ref: ref('note', 'n1'), excerpt: `${'z'.repeat(3000)}\n\nmore` },
    }))
    expect(snapshot.selection).toHaveLength(AGENT_CONTEXT_MAX_REFS)
    expect(snapshot.visible).toHaveLength(AGENT_CONTEXT_MAX_REFS)
    expect(snapshot.locked).toHaveLength(AGENT_CONTEXT_MAX_REFS)
    expect(snapshot.consent.privateRefs).toHaveLength(AGENT_CONTEXT_MAX_REFS)
    expect(snapshot.textSelection?.excerpt.length).toBeLessThanOrEqual(AGENT_EXCERPT_MAX_CHARS)
  })

  it('leaves an already-small snapshot alone', () => {
    const original = context({ focus: ref('note', 'n1'), selection: [ref('task', 't1')] })
    expect(normalizeContextSnapshot(original)).toEqual(original)
  })
})

describe('W1-15 §18.3 rule 4 — a workspace admin can disable the auto context', () => {
  it('sends only explicit chips when agent_panel.auto_context is off', () => {
    const full = context({
      focus: ref('note', 'n1'),
      selection: [ref('task', 't1')],
      visible: [ref('task', 't2')],
      textSelection: { ref: ref('note', 'n1'), excerpt: 'выделено' },
      view: { kind: 'list' },
      consent: { privateRefs: [ref('note', 'private-1')] },
      locked: [ref('goal', 'g1')],
    })
    const dispatched = contextForDispatch(full, false)
    expect(dispatched.focus).toBeUndefined()
    expect(dispatched.selection).toBeUndefined()
    expect(dispatched.visible).toBeUndefined()
    expect(dispatched.textSelection).toBeUndefined()
    expect(dispatched.view).toBeUndefined()
    expect(dispatched.consent.privateRefs.map((item) => item.id)).toEqual(['private-1'])
    expect(dispatched.locked.map((item) => item.id)).toEqual(['g1'])
    // …and the auto context is untouched when the policy allows it.
    expect(contextForDispatch(full, true).focus?.id).toBe('n1')
  })
})

describe('W1-15 §18.2 — expansion order, redaction and the 24 k-token budget', () => {
  it('orders the groups focus → textSelection → selection → locked → visible', () => {
    const ctx = context({
      focus: ref('note', 'n1'),
      textSelection: { ref: ref('note', 'n1'), excerpt: 'x' },
      selection: [ref('task', 't1')],
      locked: [ref('goal', 'g1')],
      visible: [ref('task', 't2')],
    })
    expect(contextGroupRefs(ctx, 'focus').map((item) => item.id)).toEqual(['n1'])
    expect(contextGroupRefs(ctx, 'textSelection').map((item) => item.id)).toEqual(['n1'])
    expect(contextGroupRefs(ctx, 'selection').map((item) => item.id)).toEqual(['t1'])
    expect(contextGroupRefs(ctx, 'locked').map((item) => item.id)).toEqual(['g1'])
    expect(contextGroupRefs(ctx, 'visible').map((item) => item.id)).toEqual(['t2'])
  })

  it('redacts an unreadable ref to {restricted:true} and drops a secret one', () => {
    const expanded: ExpandedContextRef[] = [
      { ref: ref('note', 'n1'), group: 'focus', text: 'ok' },
      { ref: ref('note', 'n2'), group: 'selection', text: 'hidden' },
      { ref: ref('note', 'n3'), group: 'visible', text: 'secret' },
    ]
    const redacted = redactExpandedRefs(expanded, (candidate) => ({
      canRead: candidate.id !== 'n2',
      secret: candidate.id === 'n3',
    }))
    expect(redacted).toEqual([
      { ref: ref('note', 'n1'), group: 'focus', text: 'ok' },
      { ref: ref('note', 'n2'), group: 'selection', restricted: true },
    ])
  })

  it('drops the lowest-priority groups until the block fits, never the focus', () => {
    const entry = (group: ExpandedContextRef['group']): ExpandedContextRef => ({ ref: ref('note', group), group })
    const ordered = [entry('focus'), entry('textSelection'), entry('selection'), entry('locked'), entry('visible')]
    const sizeOf = (value: ExpandedContextRef) => (value.group === 'focus' || value.group === 'selection' ? 1000 : 400)

    // 1000 + 400 + 1000 = 2400 fits exactly: locked and visible go.
    expect(fitContextBudget(ordered, sizeOf, 2400).map((value) => value.group)).toEqual(['focus', 'textSelection', 'selection'])
    expect(fitContextBudget(ordered, sizeOf, AGENT_CONTEXT_MAX_TOKENS)).toHaveLength(5)
    // A focus that alone exceeds the budget is still kept (the user is looking at it).
    expect(fitContextBudget([entry('focus')], () => Number.MAX_SAFE_INTEGER, 1).map((value) => value.group)).toEqual(['focus'])
  })

  it('estimates tokens at 4 characters per token', () => {
    expect(estimateContextTokens('')).toBe(0)
    expect(estimateContextTokens('a'.repeat(4000))).toBe(1000)
    expect(estimateContextTokens('a'.repeat(4001))).toBe(1001)
  })
})

describe('W1-15 §18.1 — fallback provider', () => {
  it('falls back to {surface, route, title} with no refs', () => {
    const ctx = fallbackSurfaceContext({ surface: 'settings', route: 'rox://settings/appearance', title: 'Настройки' })
    expect(ctx).toEqual({
      v: 1,
      workspaceId: null,
      surface: 'settings',
      route: 'rox://settings/appearance',
      title: 'Настройки',
      locale: 'ru',
      timeZone: 'Europe/Moscow',
      consent: { privateRefs: [] },
      locked: [],
    })
    expect(fallbackSurfaceContext({ surface: 'home', route: 'rox://home', title: 'Главная', workspaceId: 'w1', locale: 'en', timeZone: 'UTC' }).workspaceId).toBe('w1')
  })

  it('offers the four generic quick actions, and at most four of any provider set render', () => {
    expect(fallbackQuickActions().map((action) => action.titleKey)).toEqual([...FALLBACK_QUICK_ACTION_KEYS])
    expect(MAX_QUICK_ACTIONS).toBeGreaterThan(MAX_VISIBLE_QUICK_ACTIONS)
    expect(MAX_VISIBLE_QUICK_ACTIONS).toBe(4)
  })
})