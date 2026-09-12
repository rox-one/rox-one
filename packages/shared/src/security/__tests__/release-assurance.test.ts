import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNoSecretsInArtifact, scanTextForSecrets } from '../secret-scan.ts'
import { assertCredentialReferenceOnly, hasRawSecretFields } from '../credential-ref-policy.ts'
import {
  readIncidentKillSwitch,
  releaseEvidenceIds,
  writeIncidentKillSwitch,
} from '../release-assurance.ts'

describe('secret scan', () => {
  it('flags PEM and access-key shapes without echoing them', () => {
    const text = 'header -----BEGIN PRIVATE KEY-----abc footer AKIAIOSFODNN7EXAMPLE'
    const findings = scanTextForSecrets(text)
    expect(findings.map((f) => f.id).sort()).toEqual(['aws-access-key', 'pem-private-key'])
    expect(() => assertNoSecretsInArtifact(text, 'log')).toThrow(/credential-shaped/)
    try {
      assertNoSecretsInArtifact(text, 'log')
    } catch (error) {
      expect((error as Error).message).not.toContain('AKIA')
      expect((error as Error).message).not.toContain('BEGIN PRIVATE')
    }
  })

  it('accepts redacted logs', () => {
    expect(scanTextForSecrets('token=[REDACTED] user=ws-a')).toEqual([])
  })
})

describe('credential-reference enforcement', () => {
  it('rejects raw apiKey payloads', () => {
    expect(hasRawSecretFields({ apiKey: 'sk-live-not-a-real-key' })).toBe(true)
    expect(() => assertCredentialReferenceOnly({ apiKey: 'sk-live-not-a-real-key' }, 'llm')).toThrow(/credentialRef/)
  })

  it('allows reference-only records', () => {
    expect(hasRawSecretFields({ credentialRef: 'cred_abc', provider: 'openai' })).toBe(false)
    expect(() => assertCredentialReferenceOnly({ credentialRef: 'cred_abc' })).not.toThrow()
  })
})

describe('incident kill switch', () => {
  it('round-trips enabled state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-kill-'))
    try {
      expect(readIncidentKillSwitch(dir).enabled).toBe(false)
      writeIncidentKillSwitch(dir, { enabled: true, reason: 'incident', setAt: '2026-09-12T00:00:00.000Z' })
      expect(readIncidentKillSwitch(dir)).toEqual({
        enabled: true,
        reason: 'incident',
        setAt: '2026-09-12T00:00:00.000Z',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('release evidence checklist', () => {
  it('covers the Issue 34 assurance items', () => {
    expect(releaseEvidenceIds()).toEqual([
      'tests',
      'security',
      'secret-scan',
      'credential-refs',
      'kill-switch',
      'audit-export',
      'migrations',
    ])
  })
})
