import { describe, expect, it } from 'bun:test'
import { ROX_VISIBLE_TERMS } from '../../identity/terms.ts'
import {
  CLI_COMMAND_CATALOG,
  ROX_CLI_RUNTIME_LABEL,
  cliCommandsForSurface,
  getCliCommand,
  resolveCliSlash,
} from '../command-catalog.ts'

describe('Rox CLI command catalog', () => {
  it('names the user-facing runtime Rox CLI and keeps compatibility ids', () => {
    expect(ROX_CLI_RUNTIME_LABEL).toBe(ROX_VISIBLE_TERMS.cli)
    expect(CLI_COMMAND_CATALOG.map((entry) => entry.id)).toEqual([
      'safe',
      'ask',
      'allow-all',
      'compact',
      'undo',
      'share',
      'join',
      'export',
      'vibe',
    ])
    for (const entry of CLI_COMMAND_CATALOG) {
      expect(entry.slash).toBe(`/${entry.id}`)
      expect(entry.compatibilityId).toBe(entry.id)
    }
  })

  it('maps share, join, export and vibe to native surfaces, not terminal-only', () => {
    expect(getCliCommand('share')?.nativeSurface).toBe('session-menu')
    expect(getCliCommand('share')?.nativeActionKey).toBe('sessionMenu.share')
    expect(getCliCommand('join')?.nativeActionKey).toBe('sessionMenu.join')
    expect(getCliCommand('export')?.nativeActionKey).toBe('sessionMenu.export')
    expect(getCliCommand('vibe')?.nativeSurface).toBe('settings')
    expect(cliCommandsForSurface('session-menu').map((e) => e.id)).toEqual(['share', 'join', 'export'])
  })

  it('resolves slash tokens from composer input', () => {
    expect(resolveCliSlash('/share')?.id).toBe('share')
    expect(resolveCliSlash('  /export notes.json')?.id).toBe('export')
    expect(resolveCliSlash('join https://agents.rox.one/s/x')?.id).toBe('join')
    expect(resolveCliSlash('/unknown')).toBeUndefined()
    expect(resolveCliSlash('')).toBeUndefined()
  })

  it('points every catalog label at an i18n key', () => {
    for (const entry of CLI_COMMAND_CATALOG) {
      expect(entry.labelKey.startsWith('cli.command.')).toBe(true)
      expect(entry.useCaseKey.startsWith('cli.command.')).toBe(true)
    }
  })
})
