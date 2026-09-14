/**
 * Meeting adversarial security (I028).
 * Speech, screen frames, and retrieved docs are untrusted data — never authority.
 * Checks run before retrieval and again before publication. Deny by default.
 * Audit is sanitized: no raw transcript, tokens, or secrets.
 */

import {
  FORBIDDEN_AUTHOR_TOOLS,
  isHostSecretPath,
  isUntrustedInstruction,
  type MeetingGrant,
} from '@craft-agent/shared/meeting-agents'
import { MeetingExecutor, type EffectAdapter } from './executor.ts'
import { exportMeeting, type MeetingExportFormat } from './exports.ts'
import type { InboxProposal } from './proposals.ts'
import { buildSharedRecap, type MeetingShareActor, type MeetingShareRecord } from './sharing.ts'
import { containsSensitiveIdentifier } from './sensitive.ts'

export { containsSensitiveIdentifier, redactSensitiveIdentifiers } from './sensitive.ts'

export type MeetingSecuritySource = 'speech' | 'screen' | 'doc'

export type MeetingSecurityCounts = {
  modelCalls: number
  remoteWrites: number
  forbiddenCalls: number
  unauthorizedTools: number
}

export type MeetingRpcSession = {
  workspaceId: string | null
  accountId?: string
}

export type MeetingRpcClaim = {
  workspaceId: string
  accountId?: string
  target?: string
  allowedTargets?: readonly string[]
}

export type MeetingSecurityDecision =
  | { ok: true }
  | { ok: false; code: string; message: string }

export type MeetingAuditEvent = {
  code: string
  decision: 'allow' | 'deny'
  transcript?: string
  token?: string
  apiKey?: string
  text?: string
  quote?: string
}

export type SanitizedMeetingAudit = {
  code: string
  decision: 'allow' | 'deny'
  message: string
}

const TOKEN_RE = /(?:sk-|ghp_|github_pat_|Bearer\s+)[A-Za-z0-9._-]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function emptyMeetingSecurityCounts(): MeetingSecurityCounts {
  return { modelCalls: 0, remoteWrites: 0, forbiddenCalls: 0, unauthorizedTools: 0 }
}

export function inspectUntrustedInput(text: string, _source: MeetingSecuritySource): MeetingSecurityDecision {
  if (!text.trim()) return { ok: false, code: 'empty-input', message: 'Empty untrusted input is denied' }
  if (isUntrustedInstruction(text)) {
    return { ok: false, code: 'injection', message: 'Untrusted instruction in speech, screen, or document' }
  }
  if (containsSensitiveIdentifier(text)) {
    return { ok: false, code: 'sensitive-identifier', message: 'W2 / tax identifiers cannot be retrieved or published' }
  }
  return { ok: true }
}

export function authorizeMeetingRpc(
  session: MeetingRpcSession,
  claimed: MeetingRpcClaim,
): MeetingSecurityDecision {
  if (session.workspaceId && session.workspaceId !== claimed.workspaceId) {
    return { ok: false, code: 'forged-workspace', message: 'RPC workspace does not match the authenticated session' }
  }
  if (session.accountId && claimed.accountId && session.accountId !== claimed.accountId) {
    return { ok: false, code: 'forged-actor', message: 'RPC actor does not match the authenticated session' }
  }
  if (claimed.target && claimed.allowedTargets && !claimed.allowedTargets.includes(claimed.target)) {
    return { ok: false, code: 'forged-target', message: 'RPC target is outside the granted allowlist' }
  }
  if (!session.workspaceId && !session.accountId && claimed.accountId) {
    return { ok: false, code: 'unauthenticated', message: 'RPC actor is not taken from the request body' }
  }
  return { ok: true }
}

export function authorizeMeetingTool(name: string, args: { path?: string } = {}): MeetingSecurityDecision {
  if ((FORBIDDEN_AUTHOR_TOOLS as readonly string[]).includes(name) || name === 'read_secret' || name === 'cat') {
    return { ok: false, code: 'unauthorized-tool', message: 'Tool is not on the meeting allowlist' }
  }
  if (args.path && isHostSecretPath(args.path)) {
    return { ok: false, code: 'secret-access', message: 'Sandbox cannot read host credentials' }
  }
  return { ok: true }
}

export function sanitizeMeetingAudit(event: MeetingAuditEvent): SanitizedMeetingAudit {
  const raw = [event.transcript, event.token, event.apiKey, event.text, event.quote]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
  const leaked = TOKEN_RE.test(raw) || EMAIL_RE.test(raw) || /attacker@/i.test(raw) || containsSensitiveIdentifier(raw)
  TOKEN_RE.lastIndex = 0
  EMAIL_RE.lastIndex = 0
  return {
    code: event.code,
    decision: event.decision,
    message: leaked || event.decision === 'deny'
      ? 'Meeting action denied'
      : 'Meeting action allowed',
  }
}

export class MeetingSecurityGate {
  readonly counts: MeetingSecurityCounts = emptyMeetingSecurityCounts()
  readonly audit: SanitizedMeetingAudit[] = []

  inspect(text: string, source: MeetingSecuritySource): MeetingSecurityDecision {
    const decision = inspectUntrustedInput(text, source)
    if (!decision.ok) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: decision.code,
        decision: 'deny',
        transcript: text,
        text,
      }))
    }
    return decision
  }

  retrieve(input: { speech?: string; screen?: string; doc?: string }): MeetingSecurityDecision {
    for (const [source, text] of [
      ['speech', input.speech],
      ['screen', input.screen],
      ['doc', input.doc],
    ] as const) {
      if (!text) continue
      const decision = this.inspect(text, source)
      if (!decision.ok) return decision
    }
    this.counts.modelCalls += 1
    return { ok: true }
  }

  publish(input: {
    record: MeetingShareRecord
    actor: MeetingShareActor
    text?: string
    now?: number
  }): MeetingSecurityDecision {
    if (input.text) {
      const decision = this.inspect(input.text, 'doc')
      if (!decision.ok) return decision
    }
    const recap = buildSharedRecap(input.record, input.actor, input.now)
    if (recap.notes.some((note) => note.audience === 'private')) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: 'private-note-leak',
        decision: 'deny',
        text: recap.text,
      }))
      return { ok: false, code: 'private-note-leak', message: 'Private notes cannot be published to a shared recap' }
    }
    if (containsSensitiveIdentifier(recap.text) || (input.record.transcript && containsSensitiveIdentifier(input.record.transcript))) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: 'sensitive-identifier',
        decision: 'deny',
        text: recap.text,
      }))
      return { ok: false, code: 'sensitive-identifier', message: 'W2 / tax identifiers cannot be published' }
    }
    return { ok: true }
  }

  callTool(name: string, args?: { path?: string }): MeetingSecurityDecision {
    const decision = authorizeMeetingTool(name, args)
    if (!decision.ok) {
      this.counts.forbiddenCalls += 1
      this.counts.unauthorizedTools += 1
      this.audit.push(sanitizeMeetingAudit({
        code: decision.code,
        decision: 'deny',
        text: args?.path,
      }))
    }
    return decision
  }

  exportFor(
    record: MeetingShareRecord,
    actor: MeetingShareActor,
    format: MeetingExportFormat = 'json',
    now = 0,
  ): MeetingSecurityDecision {
    const sourceLeak = [record.transcript, ...record.notes.filter((note) => note.audience === 'shared').map((note) => note.text)]
      .filter((value): value is string => typeof value === 'string')
      .some((text) => containsSensitiveIdentifier(text))
    if (sourceLeak) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: 'sensitive-identifier',
        decision: 'deny',
        text: record.transcript,
      }))
      return { ok: false, code: 'sensitive-identifier', message: 'Shared export cannot include W2 / tax identifiers' }
    }
    const result = exportMeeting(record, actor, { format, audience: 'shared', now })
    if (!result.ok) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: result.code,
        decision: 'deny',
        text: record.transcript,
      }))
      return { ok: false, code: result.code, message: result.message }
    }
    if (result.bundle.notes.some((note) => note.audience === 'private')) {
      this.counts.forbiddenCalls += 1
      return { ok: false, code: 'private-note-leak', message: 'Shared export cannot include private notes' }
    }
    const leaked = [result.bundle.transcript, ...result.bundle.notes.map((note) => note.text)]
      .filter((value): value is string => typeof value === 'string')
      .some((text) => containsSensitiveIdentifier(text))
    if (leaked) {
      this.counts.forbiddenCalls += 1
      return { ok: false, code: 'sensitive-identifier', message: 'Shared export cannot include W2 / tax identifiers' }
    }
    return { ok: true }
  }

  rpc(session: MeetingRpcSession, claimed: MeetingRpcClaim): MeetingSecurityDecision {
    const decision = authorizeMeetingRpc(session, claimed)
    if (!decision.ok) {
      this.counts.forbiddenCalls += 1
      this.audit.push(sanitizeMeetingAudit({
        code: decision.code,
        decision: 'deny',
        text: claimed.accountId,
      }))
    }
    return decision
  }
}

export async function executeUnlessRevoked(input: {
  proposal: InboxProposal
  actorId: string
  workspaceId: string
  deviceId: string
  now: number
  grants: readonly MeetingGrant[]
  adapter: EffectAdapter
}): Promise<{ status: string; remoteWrites: number }> {
  const exec = new MeetingExecutor(input.adapter)
  const job = await exec.executeApprovedProposal({
    proposal: input.proposal,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    now: input.now,
    grants: input.grants,
  })
  return { status: job.status, remoteWrites: exec.effectCount() }
}
