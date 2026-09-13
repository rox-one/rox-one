import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../transport-wait.ts'), 'utf8')

describe('transport-wait reconnect errors are i18n', () => {
  it('uses existing transport/workspace keys instead of hardcoded English', () => {
    expect(source).toContain("i18n.t('workspace.connectionFailed')")
    expect(source).toContain("i18n.t('workspace.connectionTimeout'")
    expect(source).toContain("i18n.t('transport.wsClosedReason'")
    expect(source).toContain("i18n.t('transport.wsClosedWithCode'")
    expect(source).not.toContain("'Connection failed'")
    expect(source).not.toContain('Connection closed (')
    expect(source).not.toContain('Timed out waiting for workspace connection after')
  })
})
