import { describe, expect, it } from 'bun:test'
import { CodedError } from '@craft-agent/shared/protocol'
import type { RequestContext } from '../transport/types.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FileScopeAudit,
  MemoryScopeAudit,
  assertCallerOwnsWorkspace,
  assertIncidentKillSwitchInactive,
  exportScopeAudit,
  readScopeAuditLog,
} from './workspace-scope.ts'

function ctx(workspaceId: string | null): RequestContext {
  return { clientId: 'c1', workspaceId, webContentsId: 1 }
}

describe('assertCallerOwnsWorkspace', () => {
  it('allows the caller workspace to read its own identifier', () => {
    const audit = new MemoryScopeAudit()
    expect(() => assertCallerOwnsWorkspace(ctx('ws-a'), 'ws-a', audit, 'cloud-run')).not.toThrow()
    expect(audit.events).toEqual([])
  })

  it('denies a workspace B identifier and records a safe audit event', () => {
    const audit = new MemoryScopeAudit()
    try {
      assertCallerOwnsWorkspace(ctx('ws-a'), 'ws-b', audit, 'cloud-run')
      throw new Error('expected deny')
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError)
      expect((error as CodedError).code).toBe('AUTH_FAILED')
      expect((error as CodedError).message).toBe('security.assurance.crossWorkspaceDenied')
      expect((error as CodedError).message).not.toContain('ws-b')
    }
    expect(audit.events).toHaveLength(1)
    expect(audit.events[0]?.action).toBe('cross-workspace-denied')
    expect(audit.events[0]?.callerWorkspaceId).toBe('ws-a')
    expect(audit.events[0]?.outcome).toBe('denied')
  })

  it('denies a missing caller workspace (fail closed)', () => {
    const audit = new MemoryScopeAudit()
    expect(() => assertCallerOwnsWorkspace(ctx(null), 'ws-a', audit)).toThrow(CodedError)
    expect(audit.events[0]?.action).toBe('cross-workspace-denied')
  })
})

describe('incident kill switch', () => {
  it('blocks cloud actions when enabled', () => {
    const audit = new MemoryScopeAudit()
    expect(() => assertIncidentKillSwitchInactive(true, audit, 'ws-a')).toThrow(CodedError)
    expect(audit.events[0]?.action).toBe('kill-switch-blocked')
  })

  it('no-ops when inactive', () => {
    const audit = new MemoryScopeAudit()
    expect(() => assertIncidentKillSwitchInactive(false, audit, 'ws-a')).not.toThrow()
    expect(audit.events).toEqual([])
  })
})

describe('file audit', () => {
  it('persists JSONL without the foreign workspace id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-scope-audit-'))
    try {
      const audit = new FileScopeAudit(join(dir, 'security-audit.jsonl'))
      try {
        assertCallerOwnsWorkspace(ctx('ws-a'), 'ws-b', audit, 'cloud-run')
      } catch {
        // expected
      }
      const dumped = exportScopeAudit(readScopeAuditLog(dir))
      expect(dumped).toContain('cross-workspace-denied')
      expect(dumped).toContain('ws-a')
      expect(dumped).not.toContain('ws-b')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('audit export', () => {
  it('writes JSONL without secret fields', () => {
    const audit = new MemoryScopeAudit()
    try {
      assertCallerOwnsWorkspace(ctx('ws-a'), 'ws-b', audit, 'cloud-run')
    } catch {
      // expected
    }
    const dumped = exportScopeAudit(audit.events)
    expect(dumped).toContain('cross-workspace-denied')
    expect(dumped).not.toMatch(/token|password|secret/i)
    expect(dumped.endsWith('\n')).toBe(true)
  })
})
