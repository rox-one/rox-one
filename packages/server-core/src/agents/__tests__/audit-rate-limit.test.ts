/**
 * W1-11 (#1508) — Local token buckets (TECH-SPEC §13.8, DATA-MODEL §5.14) and
 * the JSONL audit chain (`{configDir}/audit/`, DATA-MODEL §5.13 local mode).
 *
 * The bucket test drives the real defaults from `DEFAULT_RATE_LIMIT_POLICY`, so
 * a change to the spec table shows up here; the audit test writes real files in
 * a temp config dir (never the user's `~/rox`).
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_ALL_SUBJECT, AGGREGATE_SCOPE, DEFAULT_RATE_LIMIT_POLICY, RULE_ALL_SUBJECT, agentRateLimitSubject } from '@rox/core/agents'
import { auditMonthOf, JsonlAuditLog } from '../audit-log.ts'
import { InMemoryRateLimiter, rateLimitBucketKey } from '../rate-limit.ts'
import type { AuditRowInput } from '@rox/core/agents'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rox-agents-audit-'))
  dirs.push(dir)
  return dir
}

function auditRow(overrides: Partial<AuditRowInput> = {}): AuditRowInput {
  return {
    auditId: 'audit-1',
    workspaceId: 'ws-1',
    actorPrincipalId: 'agent-1',
    actorKind: 'bot',
    onBehalfOf: 'owner-1',
    commandType: 'im.send_message',
    targetRef: 'channel:1',
    decision: 'executed',
    riskClass: 'consequential',
    provenance: { trigger: 'mention' },
    requestHash: 'request-hash',
    createdAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  }
}

describe('token buckets (DATA-MODEL §5.14 defaults)', () => {
  it('admits exactly perMinute messages and refuses the next with a retryAfter', () => {
    let now = 1_000_000
    const limiter = new InMemoryRateLimiter({ now: () => now })
    const subject = agentRateLimitSubject('agent-1')
    const send = { workspaceId: 'ws-1', subject, scope: 'im:send_chat' }
    // 10 per minute, 120 per hour, 500 per day.
    for (let index = 0; index < 10; index += 1) expect(limiter.consume(send).allowed, `message ${index}`).toBe(true)
    const refused = limiter.consume(send)
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) {
      expect(refused.window).toBe('minute')
      expect(refused.retryAfter).toBe(60)
    }
    // The next window admits again.
    now += 60_000
    expect(limiter.consume(send).allowed).toBe(true)
  })

  it('spends the scope bucket first and the aggregate bucket second', () => {
    const limiter = new InMemoryRateLimiter()
    const spend = limiter.consume({ workspaceId: 'ws-1', subject: agentRateLimitSubject('agent-1'), scope: 'tasks:create' })
    expect(spend.allowed).toBe(true)
    expect(spend.charged).toEqual(['tasks:create', AGGREGATE_SCOPE])
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: agentRateLimitSubject('agent-1'), scope: 'tasks:create' })).toEqual({ minute: 1, hour: 1, day: 1 })
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: agentRateLimitSubject('agent-1'), scope: AGGREGATE_SCOPE })).toEqual({ minute: 1, hour: 1, day: 1 })
  })

  it('an exhausted aggregate bucket blocks a different scope too', () => {
    const now = 1_000_000
    const limiter = new InMemoryRateLimiter({ now: () => now, policy: [{ subject: AGENT_ALL_SUBJECT, scope: AGGREGATE_SCOPE, perMinute: 2, perHour: null, perDay: null }] })
    const subject = agentRateLimitSubject('agent-1')
    expect(limiter.consume({ workspaceId: 'ws-1', subject, scope: 'tasks:create' }).allowed).toBe(true)
    expect(limiter.consume({ workspaceId: 'ws-1', subject, scope: 'docs:create' }).allowed).toBe(true)
    const refused = limiter.consume({ workspaceId: 'ws-1', subject, scope: 'tasks:create' })
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) expect(refused.window).toBe('minute')
  })

  it('honours the hourly ceiling of `im:create_group` (5/h) and keeps the day window', () => {
    let now = 1_000_000
    const limiter = new InMemoryRateLimiter({ now: () => now })
    const subject = agentRateLimitSubject('agent-1')
    const spend = { workspaceId: 'ws-1', subject, scope: 'im:create_group' }
    for (let index = 0; index < 5; index += 1) expect(limiter.consume(spend).allowed).toBe(true)
    const refused = limiter.consume(spend)
    expect(refused.allowed).toBe(false)
    if (!refused.allowed) {
      expect(refused.window).toBe('hour')
      expect(refused.retryAfter).toBe(3600)
    }
    now += 3_600_000
    for (let index = 0; index < 5; index += 1) expect(limiter.consume(spend).allowed).toBe(true)
    // 10 creations in the day: the 20/day ceiling still holds.
    now += 3_600_000
    for (let index = 0; index < 5; index += 1) expect(limiter.consume(spend).allowed).toBe(true)
    now += 3_600_000
    for (let index = 0; index < 5; index += 1) expect(limiter.consume(spend).allowed).toBe(true)
    now += 3_600_000
    const refusedDaily = limiter.consume(spend)
    expect(refusedDaily.allowed).toBe(false)
  })

  it('keeps separate counters per subject and per workspace', () => {
    const limiter = new InMemoryRateLimiter()
    const first = agentRateLimitSubject('agent-1')
    const second = agentRateLimitSubject('agent-2')
    limiter.consume({ workspaceId: 'ws-1', subject: first, scope: 'tasks:create' })
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: first, scope: 'tasks:create' })?.minute).toBe(1)
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: second, scope: 'tasks:create' })).toBeNull()
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: first, scope: AGGREGATE_SCOPE })?.minute).toBe(1)
    const other = limiter.consume({ workspaceId: 'ws-2', subject: first, scope: 'tasks:create' })
    expect(other.allowed).toBe(true)
    expect(rateLimitBucketKey({ workspaceId: 'ws-1', subject: first, scope: 'tasks:create' }))
      .not.toBe(rateLimitBucketKey({ workspaceId: 'ws-2', subject: first, scope: 'tasks:create' }))
  })

  it('a rule bucket is not charged to the agent aggregate', () => {
    const limiter = new InMemoryRateLimiter()
    const charged = limiter.consume({ workspaceId: 'ws-1', subject: RULE_ALL_SUBJECT, scope: AGGREGATE_SCOPE })
    expect(charged.allowed).toBe(true)
    expect(charged.charged).toEqual([AGGREGATE_SCOPE])
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: RULE_ALL_SUBJECT, scope: AGGREGATE_SCOPE })?.hour).toBe(1)
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject: 'agent:*', scope: AGGREGATE_SCOPE })).toBeNull()
    expect(DEFAULT_RATE_LIMIT_POLICY.some(bucket => bucket.subject === RULE_ALL_SUBJECT)).toBe(true)
  })

  it('an unknown scope is unlimited, and a policy change takes effect', () => {
    const limiter = new InMemoryRateLimiter()
    const subject = agentRateLimitSubject('agent-1')
    for (let index = 0; index < 50; index += 1) {
      expect(limiter.consume({ workspaceId: 'ws-1', subject, scope: 'unknown:scope' }).allowed).toBe(true)
    }
    // The first scoped call admitted 50 unlimited commands, so the counter
    // starts at zero when the policy finally covers the scope.
    limiter.setPolicy([{ subject: AGENT_ALL_SUBJECT, scope: 'unknown:scope', perMinute: 1, perHour: null, perDay: null }])
    expect(limiter.consume({ workspaceId: 'ws-1', subject, scope: 'unknown:scope' }).allowed).toBe(true)
    expect(limiter.consume({ workspaceId: 'ws-1', subject, scope: 'unknown:scope' }).allowed).toBe(false)
    limiter.clear()
    expect(limiter.snapshot({ workspaceId: 'ws-1', subject, scope: 'unknown:scope' })).toBeNull()
  })
})

describe('JSONL audit log ({configDir}/audit/)', () => {
  it('writes one private file per month, chained across months', () => {
    const configDir = tempConfigDir()
    const log = new JsonlAuditLog({ configDir })
    const first = log.append(auditRow({ auditId: 'a1', createdAt: '2026-10-31T23:00:00.000Z' }))
    const second = log.append(auditRow({ auditId: 'a2', createdAt: '2026-11-01T01:00:00.000Z' }))
    expect(first.prevHash).toBeNull()
    expect(first.seq).toBe(1)
    // Rotation starts a fresh chain in the new file, so every month verifies on
    // its own (the server keeps one per-workspace chain in `audit_log`).
    expect(second.prevHash).toBeNull()
    expect(second.seq).toBe(1)
    expect(auditMonthOf('2026-10-31T23:00:00.000Z')).toBe('2026-10')
    expect(log.months()).toEqual(['2026-10', '2026-11'])
    expect(log.read('2026-10')).toHaveLength(1)
    expect(log.read('2026-11')).toHaveLength(1)
    expect(log.verify()).toEqual({ ok: true, rows: 2 })
    const file = log.filePathFor('2026-10')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(configDir, 'audit')).mode & 0o777).toBe(0o700)
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('verifies a chain written by another process and fails on a tampered line', () => {
    const configDir = tempConfigDir()
    const writer = new JsonlAuditLog({ configDir })
    writer.append(auditRow({ auditId: 'a1' }))
    writer.append(auditRow({ auditId: 'a2', commandType: 'tasks.create' }))
    writer.append(auditRow({ auditId: 'a3', commandType: 'docs.create_document' }))
    // A second instance (a restarted process) continues the same chain.
    const restarted = new JsonlAuditLog({ configDir })
    const fourth = restarted.append(auditRow({ auditId: 'a4', commandType: 'drive.upload_file' }))
    expect(fourth.seq).toBe(4)
    expect(restarted.verify()).toEqual({ ok: true, rows: 4 })

    const file = restarted.filePathFor('2026-10')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    const tampered = JSON.parse(lines[2] as string) as Record<string, unknown>
    tampered.decision = 'denied'
    lines[2] = JSON.stringify(tampered)
    writeFileSync(file, `${lines.join('\n')}\n`)
    const verification = new JsonlAuditLog({ configDir }).verifyMonth('2026-10')
    expect(verification.ok).toBe(false)
    expect(verification.brokenAt).toMatchObject({ index: 2, reason: 'hash_mismatch', auditId: 'a3' })

    // Removing a line breaks the link of its successor instead.
    writeFileSync(file, `${[lines[0], lines[2], lines[3]].join('\n')}\n`)
    const relinked = new JsonlAuditLog({ configDir }).verifyMonth('2026-10')
    expect(relinked.ok).toBe(false)
    expect(relinked.brokenAt).toMatchObject({ index: 1, reason: 'prev_mismatch' })
  })

  it('an empty directory verifies as an empty chain', () => {
    const log = new JsonlAuditLog({ configDir: tempConfigDir() })
    expect(log.verify()).toEqual({ ok: true, rows: 0 })
    expect(log.months()).toEqual([])
    expect(log.read('2026-10')).toEqual([])
    expect(log.tail('2026-10')).toBeNull()
  })
})