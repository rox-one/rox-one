import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, 'source-status-indicator.tsx'), 'utf8')

const KEYS = [
  'sourceStatus.connected',
  'sourceStatus.connectedHint',
  'sourceStatus.disabled',
  'sourceStatus.disabledHint',
  'sourceStatus.failed',
  'sourceStatus.failedHint',
  'sourceStatus.needsAuth',
  'sourceStatus.needsAuthHint',
  'sourceStatus.untested',
  'sourceStatus.untestedHint',
] as const

describe('source status indicator copy is i18n', () => {
  it('uses sourceStatus keys instead of hardcoded English', () => {
    for (const key of KEYS) {
      expect(source).toContain(`'${key}'`)
    }
    expect(source).toContain('useTranslation')
    expect(source).not.toContain("label: 'Connected'")
    expect(source).not.toContain("'Needs Authentication'")
    expect(source).not.toContain("'Connection Failed'")
    expect(source).not.toContain("'Failed to connect to source'")
    expect(source).not.toContain("'Not Tested'")
    expect(source).not.toContain("'Local MCP servers are disabled in Settings'")
  })
})
