/**
 * Regression coverage for the a2.5 suggestion affordance: the client must offer
 * accept/dismiss to exactly the viewer the server's resolve gate admits, which
 * resolves ownership as `owner ?? creator` (SessionManager.ts:1305). Previously
 * the menu forwarded `item.owner?.id` alone, so a creator-owned session showed
 * the affordance to every viewer and everyone but the creator got a failure.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionMeta } from '@/atoms/sessions'
import { resolveSuggestionOwnerId, viewerMayResolveSuggestions } from '../SessionSuggestionsHost'

const HERE = import.meta.dir

/** The attribution slice SessionMenu hands to the event detail. */
type Attribution = Pick<SessionMeta, 'owner' | 'creator'>

function assignedOwner(id: string): Attribution['owner'] {
  return { kind: 'account', id, displayName: `Owner ${id}`, assignedAt: 1, assignedBy: 'acc-seed' }
}

function creator(id: string): Attribution['creator'] {
  return { accountId: id, displayName: `Creator ${id}`, kind: 'profile' }
}

/** The dispatch → affordance path SessionMenu + SessionSuggestionsHost run. */
function viewerSeesAcceptDismiss(meta: Attribution, viewerId: string): boolean {
  return viewerMayResolveSuggestions(resolveSuggestionOwnerId(meta), viewerId)
}

describe('suggestion ownership resolution (owner, else creator)', () => {
  it('an assigned owner is the effective owner, ahead of the creator', () => {
    const meta: Attribution = { owner: assignedOwner('acc-a'), creator: creator('acc-c') }
    expect(resolveSuggestionOwnerId(meta)).toBe('acc-a')
  })

  it('with no assigned owner the creator is the effective owner', () => {
    expect(resolveSuggestionOwnerId({ creator: creator('acc-c') })).toBe('acc-c')
  })

  it('a fully unattributed session has no effective owner', () => {
    expect(resolveSuggestionOwnerId({})).toBeNull()
  })
})

describe('suggestion accept/dismiss affordance', () => {
  it('owner assigned → only the owner sees the affordance', () => {
    const meta: Attribution = { owner: assignedOwner('acc-a'), creator: creator('acc-c') }
    expect(viewerSeesAcceptDismiss(meta, 'acc-a')).toBe(true)
    expect(viewerSeesAcceptDismiss(meta, 'acc-c')).toBe(false)
    expect(viewerSeesAcceptDismiss(meta, 'acc-b')).toBe(false)
  })

  it('owner missing but creator known → only the creator sees the affordance', () => {
    const meta: Attribution = { creator: creator('acc-c') }
    expect(viewerSeesAcceptDismiss(meta, 'acc-c')).toBe(true)
    expect(viewerSeesAcceptDismiss(meta, 'acc-a')).toBe(false)
    expect(viewerSeesAcceptDismiss(meta, 'acc-b')).toBe(false)
  })

  it('unattributed session → the server leaves it open, so every viewer is offered it', () => {
    expect(viewerSeesAcceptDismiss({}, 'acc-a')).toBe(true)
    expect(viewerSeesAcceptDismiss({}, 'acc-b')).toBe(true)
  })
})

describe('SessionMenu wiring', () => {
  const MENU = readFileSync(join(HERE, '../SessionMenu.tsx'), 'utf8')

  it('dispatches the server-mirrored effective owner, not the raw owner id', () => {
    expect(MENU).toContain('resolveSuggestionOwnerId(item)')
    expect(MENU).not.toContain('ownerId: item.owner?.id')
  })
})