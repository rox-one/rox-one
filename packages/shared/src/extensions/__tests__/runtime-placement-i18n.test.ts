import { describe, expect, it } from 'bun:test'
import i18n from 'i18next'
import { setupI18n } from '../../i18n/setupI18n.ts'
import {
  EXTENSION_RUNTIMES,
  RUNTIME_PLACEMENT,
  resolveRuntimePlacementHint,
} from '../types.ts'

function catalogT(key: string): string {
  return String(i18n.t(key))
}

describe('RUNTIME_PLACEMENT catalog keys', () => {
  it('maps every runtime to a catalog hint key, not English sentences', () => {
    for (const runtime of EXTENSION_RUNTIMES) {
      expect(RUNTIME_PLACEMENT[runtime]).toBe(`extensions.runtime.${runtime}.hint`)
      expect(RUNTIME_PLACEMENT[runtime]).not.toMatch(/\s/)
    }
  })

  it('resolves English catalog copy and hides a catalog miss', async () => {
    await setupI18n().changeLanguage('en')
    expect(resolveRuntimePlacementHint(catalogT, 'craft-native')).toBe(
      'First-party Craft code (main/renderer)',
    )
    expect(resolveRuntimePlacementHint(catalogT, 'agent-runtime')).toBe(
      'External agent process supervisor',
    )
    expect(resolveRuntimePlacementHint(catalogT, 'web-widget')).toBe(
      'Sandboxed webContents only',
    )
    expect(resolveRuntimePlacementHint((key) => key, 'mcp-source')).toBeUndefined()
  })
})
