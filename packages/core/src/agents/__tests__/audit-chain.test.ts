/**
 * W1-11 (#1508) — Audit chain, tamper detection and the origin contract
 * (TECH-SPEC §13.4, §18.2; DATA-MODEL §5.13).
 *
 * The chain is tamper-evident per row: changing any field of any row makes the
 * verifier report that row (and, for the successor, a `prev_mismatch`). The
 * `{kind:'agent-panel'}` origin is exercised here too: it is accepted, it is
 * recorded in `provenance`, and it does not change a risk class (§18.2).
 */

import { describe, expect, it } from 'bun:test'
import { createCommandEnvelope, type CommandOrigin } from '../../commands/envelope.ts'
import { CommandRegistry } from '../../commands/registry.ts'
import { COMMAND_CATALOGUE, registerCommandCatalogue } from '../../commands/catalogue/index.ts'
import {
  AUDIT_DECISIONS,
  auditProvenanceFromOrigin,
  auditRequestHash,
  auditRowContent,
  auditRowHash,
  chainAuditRow,
  isAuditDecision,
  verifyAuditChain,
  type AuditRow,
  type AuditRowInput,
} from '../audit.ts'
import type { RiskClass } from '../../commands/registry.ts'

function row(index: number, overrides: Partial<AuditRowInput> = {}): AuditRowInput {
  return {
    auditId: `audit-${index}`,
    workspaceId: 'ws-1',
    actorPrincipalId: 'agent-1',
    actorKind: 'bot',
    onBehalfOf: 'owner-1',
    commandType: 'im.create_chat',
    targetRef: null,
    decision: 'executed',
    riskClass: 'consequential',
    provenance: { trigger: 'mention', session_id: `session-${index}` },
    requestHash: auditRequestHash(`request-${index}`),
    receipt: { status: 'applied' },
    createdAt: new Date(Date.UTC(2026, 9, 8, 12, index)).toISOString(),
    ...overrides,
  }
}

function chain(count: number): AuditRow[] {
  const rows: AuditRow[] = []
  let previous: AuditRow | null = null
  for (let index = 0; index < count; index += 1) {
    const chained = chainAuditRow(previous, row(index), index + 1)
    rows.push(chained)
    previous = chained
  }
  return rows
}

describe('audit hash chain', () => {
  it('verifies a well-formed chain and is order-sensitive', () => {
    const rows = chain(5)
    expect(verifyAuditChain(rows)).toEqual({ ok: true, rows: 5 })
    const swapped = [rows[0]!, rows[2]!, rows[1]!, rows[3]!, rows[4]!] as AuditRow[]
    expect(verifyAuditChain(swapped).ok).toBe(false)
    expect(verifyAuditChain([]).ok).toBe(true)
  })

  it('the first row has no previous hash and the second links to the first', () => {
    const rows = chain(2)
    expect(rows[0]!.prevHash).toBeNull()
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash)
  })

  it('changing any field of any row fails the verifier at that row', () => {
    const rows = chain(6)
    const mutations: Array<(row: AuditRow) => void> = [
      current => { (current as { auditId: string }).auditId = 'audit-tampered' },
      current => { (current as { decision: string }).decision = 'denied' },
      current => { (current as { riskClass: RiskClass }).riskClass = 'routine' },
      current => { (current as { actorPrincipalId: string }).actorPrincipalId = 'someone-else' },
      current => { (current as { onBehalfOf: string | null }).onBehalfOf = null },
      current => { (current as { commandType: string }).commandType = 'tasks.delete' },
      current => { (current as { targetRef: string | null }).targetRef = 'channel:other' },
      current => { (current as { requestHash: string }).requestHash = 'ff'.repeat(32) },
      current => { (current as { createdAt: string }).createdAt = '2026-01-01T00:00:00.000Z' },
      current => { (current as { provenance: unknown }).provenance = { trigger: 'rule' } },
      current => { (current as { receipt: unknown }).receipt = { status: 'applied', ref: { kind: 'channel', id: 'x' } } },
    ]
    for (const index of [0, 2, 5]) {
      for (const mutate of mutations) {
        const copy = rows.map(current => ({ ...current })) as AuditRow[]
        mutate(copy[index] as AuditRow)
        const verification = verifyAuditChain(copy)
        expect(verification.ok, `row ${index} must fail`).toBe(false)
        expect(verification.brokenAt?.index, `row ${index}`).toBe(index)
      }
    }
  })

  it('a row that is re-hashed without re-linking its successor breaks the successor instead', () => {
    const rows = chain(3)
    const forged = { ...rows[1]! } as AuditRow
    ;(forged as { decision: string }).decision = 'denied'
    forged.hash = auditRowHash(forged.prevHash, forged)
    const verification = verifyAuditChain([rows[0]!, forged, rows[2]!])
    expect(verification.ok).toBe(false)
    expect(verification.brokenAt).toMatchObject({ index: 2, reason: 'prev_mismatch' })
  })

  it('seq and hash are outside the hashed content, every other field is inside', () => {
    const base = row(0)
    const content = auditRowContent(base)
    expect(content).not.toContain('"seq"')
    expect(auditRowHash('prev', base)).toBe(auditRowHash('prev', base))
    expect(auditRowHash('prev', base)).not.toBe(auditRowHash('other', base))
    const withSeq = chainAuditRow(null, base, 7)
    expect(withSeq.seq).toBe(7)
    expect(withSeq.hash).toBe(auditRowHash(null, base))
    expect(verifyAuditChain([withSeq]).ok).toBe(true)
  })

  it('the decision vocabulary matches DATA-MODEL §5.13', () => {
    expect(AUDIT_DECISIONS).toEqual(['executed', 'proposed', 'approved', 'rejected', 'expired', 'denied', 'rate_limited', 'failed', 'undone'])
    expect(isAuditDecision('proposed')).toBe(true)
    expect(isAuditDecision('nope')).toBe(false)
  })
})

describe('audit provenance and origin (§18.2)', () => {
  it('records an agent-panel proposal as a UI trigger with its session and surface', () => {
    const origin: CommandOrigin = { kind: 'agent-panel', sessionId: 'session-9', messageId: 'message-2', surface: 'docs' }
    expect(auditProvenanceFromOrigin(origin, { transport: 'http' })).toEqual({
      transport: 'http',
      trigger: 'ui',
      session_id: 'session-9',
      message_ref: 'message-2',
      surface: 'docs',
    })
  })

  it('maps the other origins without losing the trigger', () => {
    expect(auditProvenanceFromOrigin({ kind: 'agent', sessionRef: 'session-1', messageRef: 'message-1' }))
      .toEqual({ trigger: 'mention', session_id: 'session-1', message_ref: 'message-1' })
    expect(auditProvenanceFromOrigin({ kind: 'message', chatRef: 'channel:1', seq: 4 }))
      .toEqual({ trigger: 'mention', message_ref: 'channel:1#4' })
    expect(auditProvenanceFromOrigin({ kind: 'comment', commentId: 'comment-1' }))
      .toEqual({ trigger: 'mention', message_ref: 'comment-1' })
    expect(auditProvenanceFromOrigin({ kind: 'doc-block', docRef: 'note:n1', blockId: 'blk-1' }))
      .toEqual({ message_ref: 'note:n1#blk-1' })
    expect(auditProvenanceFromOrigin({ kind: 'note', id: 'n1' })).toEqual({ message_ref: 'note:n1' })
    expect(auditProvenanceFromOrigin(undefined)).toEqual({})
  })

  it('the agent-panel origin is accepted and never changes a risk class (§18.2)', async () => {
    const registry = new CommandRegistry()
    registerCommandCatalogue(registry)
    const definition = registry.get('im.create_chat')
    expect(definition).toBeDefined()
    const payload = { kind: 'group', visibility: 'private', members: [{ id: 'p2' }] }
    const context = { workspaceId: 'ws-1', actor: { principalId: 'owner-1', kind: 'user' as const } }
    const fromMention = definition!.riskClass(payload, context)
    const fromPanel = definition!.riskClass({ ...payload, origin: { kind: 'agent-panel', sessionId: 's1' } }, context)
    expect(fromPanel).toBe(fromMention)
    expect(fromMention).toBe('consequential')
    // The envelope itself keeps both origins intact.
    const envelope = createCommandEnvelope('im.create_chat', payload, { origin: { kind: 'agent-panel', sessionId: 's1' } })
    expect(envelope.origin).toEqual({ kind: 'agent-panel', sessionId: 's1' })
    expect(COMMAND_CATALOGUE.length).toBeGreaterThan(200)
  })
})