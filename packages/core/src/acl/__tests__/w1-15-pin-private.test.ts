/**
 * W1-15 (#1512) acceptance — the ACL rule `pin-private` (X-26, DATA-MODEL
 * §5.18). Pins are private to `created_by`, so:
 *
 * - another user never sees a pin in backlinks, search or activity;
 * - the creator does not see their pin there either (it belongs to
 *   «Закреплённое», and to nothing else);
 * - an ordinary link is untouched by the rule.
 */
import { describe, expect, it } from 'bun:test'
import {
  EMPTY_LOCAL_PINS_STATE,
  LINK_VISIBILITY_RULES,
  PIN_EXCLUDED_SURFACES,
  PIN_PRIVATE_RULE,
  PIN_PRIVATE_RULE_ID,
  PIN_RELATION,
  PIN_ROLE,
  filterLinksForViewer,
  isPinLink,
  linkAllowedOnSurface,
  pinAnchorsForOrder,
  pinLinkVisibleTo,
  pinPrivateAllows,
  recordLocalPins,
  registerLinkVisibilityRule,
  sortPins,
  withLocalPin,
  withoutLocalPin,
} from '../rules/pin-private.ts'

const ref = (kind: string, id: string) => ({ kind: kind as never, id })

const pin = (createdBy: string) => ({ relation: PIN_RELATION, role: PIN_ROLE, createdBy })
const link = (relation: string, createdBy = 'me') => ({ relation, role: null, createdBy })

describe('W1-15 pin link identity', () => {
  it('recognises a pin by relation + role only', () => {
    expect(isPinLink(pin('me'))).toBe(true)
    expect(isPinLink({ relation: 'relates-to', role: 'related' })).toBe(false)
    expect(isPinLink({ relation: 'mentions', role: 'pin' })).toBe(false)
    expect(isPinLink(link('mentions'))).toBe(false)
  })
})

describe('W1-15 pins are invisible to other users (backlinks · search · activity)', () => {
  it('hides a pin from every other principal on all three surfaces', () => {
    for (const surface of PIN_EXCLUDED_SURFACES) {
      expect(linkAllowedOnSurface(pin('me'), 'other', surface)).toBe(false)
      expect(pinPrivateAllows(pin('me'), 'other', surface)).toBe(false)
    }
  })

  it('hides a pin from its own creator on those surfaces too', () => {
    for (const surface of PIN_EXCLUDED_SURFACES) {
      expect(pinPrivateAllows(pin('me'), 'me', surface)).toBe(false)
      expect(filterLinksForViewer([pin('me')], 'me', surface)).toEqual([])
    }
  })

  it('shows a pin to its creator in the «Закреплённое» list only', () => {
    expect(pinLinkVisibleTo(pin('me'), 'me')).toBe(true)
    expect(pinLinkVisibleTo(pin('me'), 'other')).toBe(false)
    expect(pinLinkVisibleTo(pin('me'), null)).toBe(false)
    expect(pinPrivateAllows(pin('me'), 'me', 'pinned')).toBe(true)
    expect(pinPrivateAllows(pin('me'), 'other', 'pinned')).toBe(false)
  })

  it('leaves an ordinary link alone — this rule is restrictive-only', () => {
    for (const surface of [...PIN_EXCLUDED_SURFACES, 'pinned']) {
      expect(pinPrivateAllows(link('mentions'), 'other', surface)).toBe(true)
    }
    const links = [link('mentions', 'me'), pin('me'), link('assigned', 'colleague')]
    expect(filterLinksForViewer(links, 'other', 'backlinks').map((entry) => entry.relation)).toEqual(['mentions', 'assigned'])
  })

  it('describes itself for the rule registry', () => {
    expect(PIN_PRIVATE_RULE.id).toBe(PIN_PRIVATE_RULE_ID)
    expect(PIN_PRIVATE_RULE.surfaces).toBe('*')
    expect(PIN_PRIVATE_RULE.rule).toContain('private to created_by')
    expect(LINK_VISIBILITY_RULES).toContain(PIN_PRIVATE_RULE)
    // Registering the same id twice is a no-op, not a duplicate.
    registerLinkVisibilityRule(PIN_PRIVATE_RULE)
    expect(LINK_VISIBILITY_RULES.filter((rule) => rule.id === PIN_PRIVATE_RULE_ID)).toHaveLength(1)
  })
})

describe('W1-15 pin order (anchor {position})', () => {
  it('sorts by anchor, keeps a missing anchor last and is stable on ties', () => {
    const sorted = sortPins([
      { id: 'c', anchor: { position: 2 } },
      { id: 'a', anchor: { position: 0 } },
      { id: 'd', anchor: null },
      { id: 'b', anchor: { position: 1 } },
      { id: 'e' },
    ])
    expect(sorted.map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('writes dense 0-based anchors and drops duplicates from a reorder payload', () => {
    expect(pinAnchorsForOrder([ref('task', 't1'), ref('goal', 'g1'), ref('task', 't1')])).toEqual([
      { ref: ref('task', 't1'), anchor: { position: 0 } },
      { ref: ref('goal', 'g1'), anchor: { position: 1 } },
    ])
  })
})

describe('W1-15 local-only pins ({configDir}/ui/pins.json)', () => {
  it('pins idempotently, keeping the original timestamp', () => {
    const once = withLocalPin(EMPTY_LOCAL_PINS_STATE, ref('task', 't1'), '2026-10-08T10:00:00.000Z')
    const twice = withLocalPin(once, ref('task', 't1'), '2026-10-09T10:00:00.000Z')
    expect(twice).toBe(once)
    expect(once.pins).toEqual([{ ref: ref('task', 't1'), position: 0, pinnedAt: '2026-10-08T10:00:00.000Z' }])
  })

  it('unpins and renumbers the remaining positions', () => {
    const state = recordLocalPins(
      withLocalPin(withLocalPin(EMPTY_LOCAL_PINS_STATE, ref('task', 't1'), 'T'), ref('goal', 'g1'), 'T'),
      [ref('task', 't1'), ref('goal', 'g1')],
      'T',
    )
    expect(state.pins.map((entry) => entry.position)).toEqual([0, 1])
    const after = withoutLocalPin(state, ref('task', 't1'))
    expect(after.pins).toEqual([{ ref: ref('goal', 'g1'), position: 0, pinnedAt: 'T' }])
    expect(withoutLocalPin(after, ref('task', 'missing'))).toBe(after)
  })

  it('reorders in place, keeping timestamps of already-pinned refs', () => {
    const first = withLocalPin(EMPTY_LOCAL_PINS_STATE, ref('task', 't1'), '2026-10-08T10:00:00.000Z')
    const reordered = recordLocalPins(first, [ref('goal', 'g1'), ref('task', 't1')], '2026-10-09T10:00:00.000Z')
    expect(reordered.pins).toEqual([
      { ref: ref('goal', 'g1'), position: 0, pinnedAt: '2026-10-09T10:00:00.000Z' },
      { ref: ref('task', 't1'), position: 1, pinnedAt: '2026-10-08T10:00:00.000Z' },
    ])
  })
})