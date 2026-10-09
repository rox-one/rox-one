import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BroPresenceMemberDto, SessionEvent } from '@rox/shared/protocol'
import { SessionOwnerChip } from '../SessionOwnerChip'
import { SessionPresenceFacepile } from '../SessionPresenceAvatars'
import { SessionTypingIndicator } from '../SessionTypingIndicator'
import { SessionParticipantsList } from '../SessionParticipantsPopover'
import { reduceSessionActivityEvent, type SessionActivityState } from '@/lib/session-presence'

const HERE = import.meta.dir

function readSource(relative: string): string {
  return readFileSync(join(HERE, relative), 'utf8')
}

describe('owner chip states', () => {
  it('renders the attributed state with the owner name', () => {
    const html = renderToStaticMarkup(
      <SessionOwnerChip owner={{ kind: 'account', id: 'acc-b', displayName: 'Анна Котова', assignedAt: 1, assignedBy: 'x' }} />,
    )
    expect(html).toContain('data-owner-state="owned"')
    expect(html).toContain('Анна Котова')
  })

  it('renders the unattributed state when no owner is assigned', () => {
    const html = renderToStaticMarkup(<SessionOwnerChip owner={null} />)
    expect(html).toContain('data-owner-state="unassigned"')
  })
})

describe('live presence avatars', () => {
  const viewer: BroPresenceMemberDto = {
    accountId: 'acc-b', displayName: 'Анна Котова', username: 'anna', role: 'editor', status: 'online', joinedAt: 1,
  }

  it('updates from a synthetic session_presence event', () => {
    const event: SessionEvent = { type: 'session_presence', sessionId: 's1', viewers: [viewer] }
    const state: Map<string, SessionActivityState> = reduceSessionActivityEvent(new Map(), event)
    const html = renderToStaticMarkup(<SessionPresenceFacepile viewers={state.get('s1')!.viewers} />)
    expect(html).toContain('data-presence-count="1"')
    expect(html).toContain('data-presence-status="online"')
    expect(html).toContain('title="Анна Котова"')
  })

  it('renders nothing without viewers', () => {
    expect(renderToStaticMarkup(<SessionPresenceFacepile viewers={[]} />)).toBe('')
  })
})

describe('typing indicator', () => {
  it('renders the actor count for a live typing snapshot', () => {
    const html = renderToStaticMarkup(
      <SessionTypingIndicator actors={[{ accountId: 'acc-b', displayName: 'Анна', expiresAt: 5 }]} />,
    )
    expect(html).toContain('data-typing-count="1"')
    expect(html).toContain('aria-live="polite"')
  })

  it('renders nothing when nobody is typing', () => {
    expect(renderToStaticMarkup(<SessionTypingIndicator actors={[]} />)).toBe('')
  })
})

describe('participant history', () => {
  it('renders creator, owner and participants sections', () => {
    const html = renderToStaticMarkup(
      <SessionParticipantsList
        creator={{ accountId: 'acc-b', displayName: 'Анна', kind: 'profile' }}
        owner={{ kind: 'account', id: 'acc-c', displayName: 'Mark', assignedAt: 1, assignedBy: 'Анна' }}
        participants={[{ accountId: 'acc-c', displayName: 'Mark', username: 'mark', kind: 'profile' }]}
      />,
    )
    expect(html).toContain('data-participant-role="creator"')
    expect(html).toContain('data-participant-role="owner"')
    expect(html).toContain('data-participant-role="participants"')
    expect(html).toContain('Mark')
  })
})

describe('multiuser UI wiring', () => {
  const HOOK = readSource('../../../hooks/useSessionMenuActions.ts')
  const MENU = readSource('../SessionMenu.tsx')
  const MENU_PARTS = readSource('../SessionMenuParts.tsx')
  const CHAT_DISPLAY = readSource('../ChatDisplay.tsx')
  const APP = readSource('../../../App.tsx')
  const FILTER = readSource('../CompactSessionListFilter.tsx')
  const APP_SHELL = readSource('../AppShell.tsx')
  const ITEM = readSource('../SessionItem.tsx')

  it('assign-owner action dispatches the frozen assignSessionOwner RPC', () => {
    expect(HOOK).toContain('window.electronAPI.assignSessionOwner(sessionId, owner)')
    expect(HOOK).toContain("assignToMe")
    expect(MENU).toContain('<OwnerMenuSection')
    expect(MENU_PARTS).toContain('export function OwnerMenuSection')
    expect(ITEM).toContain('<SessionOwnerChip')
  })

  it('visibility menu dispatches setVisibility and offers all four modes', () => {
    expect(HOOK).toContain("type: 'setVisibility', visibility")
    expect(MENU).toContain('<VisibilityMenuSection')
    for (const mode of ['shared', 'read-only', 'suggest', 'draft']) {
      expect(MENU_PARTS).toContain(`'${mode}'`)
    }
  })

  it('typing beacons are wired to input change, submit, blur and the live indicator', () => {
    expect(CHAT_DISPLAY).toContain('typingBeacon.notifyTyping()')
    expect(CHAT_DISPLAY).toContain('typingBeacon.clearTyping()')
    expect(CHAT_DISPLAY).toContain('<SessionTypingIndicator actors={typingActors} />')
    expect(CHAT_DISPLAY).toContain('useSessionTypingBeacon(session?.id)')
  })

  it('presence/typing events feed the activity atom, not the agent processor', () => {
    expect(APP).toContain("event.type === 'session_typing' || event.type === 'session_presence'")
    expect(APP).toContain('reduceSessionActivityEvent(store.get(sessionActivityMapAtom), event)')
    expect(APP).toContain("event.type === 'session_owner_changed' || event.type === 'session_visibility_changed'")
  })

  it('the owners / involving-me filter is applied to the session list', () => {
    expect(FILTER).toContain("t('sidebarFilter.involvingMe')")
    expect(FILTER).toContain("t('sidebarFilter.owners')")
    expect(APP_SHELL).toContain('sessionInvolvesViewer(meta, viewer)')
    expect(APP_SHELL).toContain('sessionMatchesOwnerFilter(meta, ownerFilter)')
    expect(APP_SHELL).toContain('ownerOptions={sessionOwnerOptions}')
  })
})