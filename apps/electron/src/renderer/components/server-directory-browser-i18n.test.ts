import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, 'ServerDirectoryBrowser.tsx'), 'utf8')

const KEYS = [
  "t('common.cancel')",
  "t('common.loading')",
  "t('serverDirectory.empty')",
  "t('serverDirectory.enterFullPath')",
  "t('serverDirectory.go')",
  "t('serverDirectory.listFailed')",
  "t('serverDirectory.select')",
  "t('serverDirectory.symlink')",
  "t('serverDirectory.truncated'",
  "t('serverDirectory.wrongPlatform')",
] as const

describe('ServerDirectoryBrowser chrome is i18n', () => {
  it('uses t() for labels, actions, and status copy', () => {
    for (const fragment of KEYS) {
      expect(source).toContain(fragment)
    }
    expect(source).not.toContain("'Failed to list directory'")
    expect(source).not.toContain('This looks like a path from a different OS.')
    expect(source).not.toContain('No subdirectories. Use the path input above to navigate.')
    expect(source).not.toContain('Enter the full path on the server:')
    expect(source).not.toContain('>Go<')
    expect(source).not.toContain('>Cancel<')
    expect(source).not.toContain('>Select<')
    expect(source).not.toContain('>Loading...')
    expect(source).not.toContain('>symlink<')
  })
})
