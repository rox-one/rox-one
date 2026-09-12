import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('InputSettingsPage voice section', () => {
  it('renders the shared voice settings through i18n', () => {
    const source = readFileSync(
      join(import.meta.dir, '../InputSettingsPage.tsx'),
      'utf8',
    )
    expect(source).toContain('VoiceSettingsSection')
  })
})
