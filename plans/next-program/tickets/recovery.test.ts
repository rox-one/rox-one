import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const ticketsDir = import.meta.dir

const RESTORED_TICKETS = [
  '01-first-run-credential.md',
  '02-oauth-callback-escape.md',
  '03-viewer-share-residuals.md',
  '04-config-defaults-one-source.md',
  '05-knowledge-panel-mount.md',
  '06-secrets-settings-slice.md',
  '07-identity-env-resolver.md',
  '08-webui-parity-hygiene.md',
  '09-session-module-prefactor.md',
  '10-legacy-mcp-contract.md',
  '11-shell-one-real-panel.md',
  '12-typed-omp-codes-on-wire.md',
  '13-live-turn-e2e.md',
  '14-decision-only.md',
  '15-omp-factory-registry.md',
] as const

describe('next-program planning tickets (#130)', () => {
  test('restores the unique ticket inventory from rox/next-program-planning-7c33', () => {
    const files = readdirSync(ticketsDir)
      .filter((name) => name.endsWith('.md'))
      .sort()
    expect(files).toEqual([...RESTORED_TICKETS])
  })
})
