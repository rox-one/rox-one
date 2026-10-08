/**
 * W1-14 (#1511) — Cross-surface contract tests (TECH-SPEC §12).
 *
 * The signature-level rules: origin → entity, the derivation key that makes a
 * replayed block command idempotent, and the risk class each command carries
 * for an agent (§13.2 step 5).
 */

import { describe, expect, test } from 'bun:test'
import {
  XSC_BULK_TASK_LIMIT, XSC_COMMAND_RISK, XSC_COMMAND_TYPES, XSC_DERIVED_FROM_RELATION, XSC_DERIVED_FROM_ROLE, XSC_DOC_BLOCK_RISK,
  xscDerivationKey, xscOriginAnchor, xscOriginRef,
} from '../commands'
import type { CommandRiskContext, RiskClass } from '../../commands/registry'

const ctx: CommandRiskContext = { workspaceId: 'ws', actor: { principalId: 'me', kind: 'user' } }
const risk = (type: string, payload: unknown): RiskClass => XSC_COMMAND_RISK[type as keyof typeof XSC_COMMAND_RISK](payload, ctx)

describe('origins (§12)', () => {
  test('a doc-block origin is the doc, with the block in the anchor', () => {
    const origin = { kind: 'doc-block' as const, docRef: 'note:d1', blockId: 'b1' }
    expect(xscOriginRef(origin)).toEqual({ kind: 'note', id: 'd1' })
    expect(xscOriginAnchor(origin)).toEqual({ blockId: 'b1' })
  })

  test('a message origin is the message, and the anchor keeps the seq', () => {
    const origin = { kind: 'message' as const, chatRef: 'channel:c1', seq: 7 }
    expect(xscOriginRef(origin)).toEqual({ kind: 'channel-message', id: 'c1:7' })
    expect(xscOriginAnchor(origin)).toEqual({ seq: 7 })
  })

  test('comment and agent origins map to their entity', () => {
    expect(xscOriginRef({ kind: 'comment', commentId: 'cm1' })).toEqual({ kind: 'comment', id: 'cm1' })
    expect(xscOriginRef({ kind: 'agent', sessionRef: 'session:s1' })).toEqual({ kind: 'session', id: 's1' })
    expect(xscOriginAnchor({ kind: 'agent', sessionRef: 'session:s1', messageRef: 'm1' })).toEqual({ sessionRef: 'session:s1', messageRef: 'm1' })
  })

  test('the derived-from link the created entity always writes', () => {
    expect(XSC_DERIVED_FROM_RELATION).toBe('derived-from')
    expect(XSC_DERIVED_FROM_ROLE).toBe('origin')
  })
})

describe('rule 3: a block command derives its ids from docRef + blockId', () => {
  test('the key is stable and distinct per block and per doc', () => {
    const doc = { kind: 'note' as const, id: 'd1' }
    expect(xscDerivationKey(doc, 'b1')).toBe('note:d1#b1')
    expect(xscDerivationKey(doc, 'b1')).toBe(xscDerivationKey({ kind: 'note', id: 'd1' }, 'b1'))
    expect(xscDerivationKey(doc, 'b2')).not.toBe(xscDerivationKey(doc, 'b1'))
    expect(xscDerivationKey({ kind: 'note', id: 'd2' }, 'b1')).not.toBe(xscDerivationKey(doc, 'b1'))
    expect(xscDerivationKey({ kind: 'note', id: 'g1', fragment: 'block-3' }, 'b1')).toBe('note:g1#block-3#b1')
  })
})

describe('risk classes (§12 "risk", §13.2)', () => {
  test('the shared rules list every §12 command exactly once', () => {
    expect(XSC_COMMAND_TYPES).toHaveLength(14)
    expect(new Set(XSC_COMMAND_TYPES).size).toBe(14)
    expect(Object.keys(XSC_COMMAND_RISK).sort()).toEqual([...XSC_COMMAND_TYPES].sort())
  })

  test('a doc-block insert is routine on a private doc and consequential on a shared one', () => {
    expect(XSC_DOC_BLOCK_RISK.local).toBe('routine')
    expect(XSC_DOC_BLOCK_RISK.workspace).toBe('consequential')
    expect(risk('docs.insert_task_block', { blockId: 'b', task: { title: 'x' } })).toBe('consequential')
  })

  test('assigning someone else is consequential, self-assignment is not', () => {
    expect(risk('tasks.create_from_selection', { title: 'x' })).toBe('routine')
    expect(risk('tasks.create_from_selection', { title: 'x', assignee: 'me' })).toBe('routine')
    expect(risk('tasks.create_from_selection', { title: 'x', assignee: 'bob' })).toBe('consequential')
    expect(risk('docs.insert_task_block', { blockId: 'b', task: { title: 'x', assignee: 'bob' } })).toBe('consequential')
  })

  test('a checklist above the bulk limit is privileged', () => {
    expect(risk('tasks.create_many_from_checklist', { blockIds: Array.from({ length: XSC_BULK_TASK_LIMIT }, () => 'b') })).toBe('routine')
    expect(risk('tasks.create_many_from_checklist', { blockIds: Array.from({ length: XSC_BULK_TASK_LIMIT + 1 }, () => 'b') })).toBe('privileged')
  })

  test('inviting people makes an event consequential, an empty one does not', () => {
    expect(risk('calendar.create_event', { title: 'x' })).toBe('routine')
    expect(risk('calendar.create_event', { title: 'x', attendees: ['bob'] })).toBe('consequential')
    expect(risk('calendar.create_event', { title: 'x', attendees: [] })).toBe('routine')
    expect(risk('docs.insert_event_block', { blockId: 'b', event: { title: 'x', attendees: ['bob'] } })).toBe('consequential')
    expect(risk('docs.insert_event_block', { blockId: 'b', event: { title: 'x' } })).toBe('routine')
    expect(risk('vc.start_meeting', { participants: ['bob'] })).toBe('consequential')
    expect(risk('vc.start_meeting', {})).toBe('routine')
    expect(risk('calendar.create_event_from_message', { attendees: 'chat' })).toBe('consequential')
  })

  test('group creation and agent invocation are consequential, messages are routine', () => {
    expect(risk('im.create_chat', { kind: 'group', members: ['bob'] })).toBe('consequential')
    expect(risk('agents.invoke', { agentRef: { kind: 'person', id: 'p' } })).toBe('consequential')
    expect(risk('im.send_message', { body: {}, mentions: [] })).toBe('routine')
    expect(risk('docs.embed_view', { blockId: 'b' })).toBe('routine')
    expect(risk('docs.create_from_messages', { seqs: [1] })).toBe('routine')
    expect(risk('docs.insert_meeting_block', { blockId: 'b', mode: 'now' })).toBe('routine')
  })
})