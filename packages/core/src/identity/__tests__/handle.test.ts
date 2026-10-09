/**
 * W1-11 (#1508) — `@rox` handle resolution (DATA-MODEL §5.12, PRD D-v2-5,
 * TECH-SPEC §13.7).
 *
 * `@rox` is a contextual alias for the *author's* agent; `@rox-<username>`
 * addresses someone else's. Resolution never crosses those lines, and a paused
 * or revoked agent never resolves (the mention then routes to the owner's DM
 * instead, §5.12).
 */

import { describe, expect, it } from 'bun:test'
import {
  AGENT_DISPLAY_NAME,
  agentCanJoinThread,
  agentDisplayHandle,
  agentDisplayName,
  agentMentionRef,
  parseAgentMention,
  parseAgentMentions,
  resolveAgentMention,
  type AgentHandleBinding,
} from '../handle.ts'

const bindings: AgentHandleBinding[] = [
  { agentPrincipalId: 'agent-ann', ownerPrincipalId: 'ann', handle: 'rox', displayHandle: 'rox-ann', displayName: 'Rox · Ann', username: 'ann', status: 'active' },
  { agentPrincipalId: 'agent-bob', ownerPrincipalId: 'bob', handle: 'rox', displayHandle: 'rox-bob', displayName: 'Rox · Bob', username: 'bob', status: 'active' },
  { agentPrincipalId: 'agent-carl', ownerPrincipalId: 'carl', handle: 'rox', displayHandle: 'rox-carl', displayName: 'Rox · Carl', username: 'carl', status: 'paused' },
]

describe('parsing mentions', () => {
  it('finds every mention in order, with its raw text', () => {
    expect(parseAgentMentions('hi @rox please file this, cc @rox-bob and @rox')).toEqual([
      { kind: 'self', raw: '@rox' },
      { kind: 'username', username: 'bob', raw: '@rox-bob' },
      { kind: 'self', raw: '@rox' },
    ])
    expect(parseAgentMentions('nothing here')).toEqual([])
  })

  it('a bare handle is a self mention; the text is matched case-insensitively', () => {
    expect(parseAgentMention('@rox')).toEqual({ kind: 'self', raw: '@rox' })
    expect(parseAgentMention('@ROX-Bob')).toEqual({ kind: 'username', username: 'bob', raw: '@ROX-Bob' })
    expect(parseAgentMention('mail me at rox@example.com')).toBeNull()
  })
})

describe('resolving mentions', () => {
  it('@rox resolves to the author\'s own agent, never to someone else\'s', () => {
    expect(resolveAgentMention({ mention: '@rox', authorPrincipalId: 'ann', bindings })?.agentPrincipalId).toBe('agent-ann')
    expect(resolveAgentMention({ mention: '@rox', authorPrincipalId: 'bob', bindings })?.agentPrincipalId).toBe('agent-bob')
    expect(resolveAgentMention({ mention: '@rox', authorPrincipalId: 'nobody', bindings })).toBeNull()
  })

  it('@rox-<username> resolves explicitly, including from an unfiltered list', () => {
    expect(resolveAgentMention({ mention: '@rox-bob', authorPrincipalId: 'ann', bindings })?.agentPrincipalId).toBe('agent-bob')
    expect(resolveAgentMention({ mention: '@rox-ann', authorPrincipalId: 'bob', bindings })?.agentPrincipalId).toBe('agent-ann')
    expect(resolveAgentMention({ mention: '@rox-unknown', authorPrincipalId: 'ann', bindings })).toBeNull()
  })

  it('a paused agent never resolves', () => {
    expect(resolveAgentMention({ mention: '@rox-carl', authorPrincipalId: 'ann', bindings })).toBeNull()
    expect(resolveAgentMention({ mention: '@rox', authorPrincipalId: 'carl', bindings })).toBeNull()
  })

  it('the stored ref is the concrete agent principal (§5.12)', () => {
    expect(agentMentionRef('agent-ann')).toEqual({ kind: 'person', id: 'agent-ann' })
  })

  it('display helpers follow D-v2-5', () => {
    expect(agentDisplayHandle('Ann')).toBe('rox-ann')
    expect(agentDisplayName()).toBe(AGENT_DISPLAY_NAME)
    expect(agentDisplayName('Марк')).toBe('Rox · Марк')
  })
})

describe('adding an agent to a thread (§5.12)', () => {
  it('only a member who may add members gets a guest bot; everyone else gets a DM reply', () => {
    expect(agentCanJoinThread({ authorIsMember: true, authorCanAddMembers: true })).toBe('guest_bot')
    expect(agentCanJoinThread({ authorIsMember: true, authorCanAddMembers: false })).toBe('dm_reply')
    expect(agentCanJoinThread({ authorIsMember: false, authorCanAddMembers: true })).toBe('dm_reply')
  })
})