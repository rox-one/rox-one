/**
 * Cross-workspace authorization (tracker Issue 34).
 *
 * Renderer-supplied workspace IDs are not authorization claims. The caller
 * identity comes from RequestContext (window binding / authenticated session).
 * Denials write a safe audit event and throw AUTH_FAILED without echoing
 * the foreign identifier.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CodedError } from '@craft-agent/shared/protocol'
import type { RequestContext } from '../transport/types.ts'

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

export type ScopeAuditAction = 'cross-workspace-denied' | 'kill-switch-blocked'

export interface ScopeAuditEvent {
  ts: string
  action: ScopeAuditAction
  callerWorkspaceId: string | null
  resourceKind: string
  outcome: 'denied'
}

export interface ScopeAuditSink {
  append(event: ScopeAuditEvent): void
}

export class MemoryScopeAudit implements ScopeAuditSink {
  readonly events: ScopeAuditEvent[] = []
  append(event: ScopeAuditEvent): void {
    this.events.push(event)
  }
}

export const SCOPE_AUDIT_FILE = 'security-audit.jsonl'

export function scopeAuditPath(configDir: string): string {
  return join(configDir, SCOPE_AUDIT_FILE)
}

export class FileScopeAudit implements ScopeAuditSink {
  constructor(private readonly filePath: string) {}
  append(event: ScopeAuditEvent): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(event)}\n`)
  }
}

export function readScopeAuditLog(configDir: string): ScopeAuditEvent[] {
  const path = scopeAuditPath(configDir)
  if (!existsSync(path)) return []
  const events: ScopeAuditEvent[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as ScopeAuditEvent)
    } catch {
      // skip a corrupt line; do not fail closed on audit read
    }
  }
  return events
}

export function resolveCallerWorkspaceId(context: RequestContext): string | null {
  if (typeof context.workspaceId === 'string' && WORKSPACE_ID_PATTERN.test(context.workspaceId)) {
    return context.workspaceId
  }
  return null
}

export function assertCallerOwnsWorkspace(
  context: RequestContext,
  resourceWorkspaceId: string,
  audit: ScopeAuditSink,
  resourceKind = 'workspace',
): void {
  const callerWorkspaceId = resolveCallerWorkspaceId(context)
  if (
    typeof resourceWorkspaceId === 'string' &&
    WORKSPACE_ID_PATTERN.test(resourceWorkspaceId) &&
    callerWorkspaceId === resourceWorkspaceId
  ) {
    return
  }
  audit.append({
    ts: new Date().toISOString(),
    action: 'cross-workspace-denied',
    callerWorkspaceId,
    resourceKind,
    outcome: 'denied',
  })
  throw new CodedError('AUTH_FAILED', 'security.assurance.crossWorkspaceDenied')
}

export function assertIncidentKillSwitchInactive(
  enabled: boolean,
  audit: ScopeAuditSink,
  callerWorkspaceId: string | null,
): void {
  if (!enabled) return
  audit.append({
    ts: new Date().toISOString(),
    action: 'kill-switch-blocked',
    callerWorkspaceId,
    resourceKind: 'cloud',
    outcome: 'denied',
  })
  throw new CodedError('AUTH_FAILED', 'security.assurance.killSwitchActive')
}

export function exportScopeAudit(events: readonly ScopeAuditEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}${events.length ? '\n' : ''}`
}
