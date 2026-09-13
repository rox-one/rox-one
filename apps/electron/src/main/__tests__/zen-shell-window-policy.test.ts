import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const windowManager = readFileSync(join(root, 'main/window-manager.ts'), 'utf8')
const settingsHandlers = readFileSync(join(root, 'main/handlers/settings.ts'), 'utf8')
const shellMaterial = readFileSync(join(root, 'main/shell-material.ts'), 'utf8')

describe('Zen Shell window policy wiring (ZS-01)', () => {
  it('attaches Zen policy only when shell.zen.v1 is enabled', () => {
    expect(windowManager).toContain("from './shell-material'")
    expect(windowManager).toContain('isZenShellEnabled')
    expect(windowManager).toContain('attachZenWindowPolicy')
    expect(windowManager).toContain('const zenEnabled = isZenShellEnabled()')
    expect(windowManager).toContain('attachZenWindowPolicy(window)')
    expect(windowManager).toMatch(/if \(zenEnabled\) \{\s*attachZenWindowPolicy\(window\)/)
  })

  it('keeps the legacy revealWindow isVisible early-return on the OFF path', () => {
    expect(windowManager).toContain('if (window.isDestroyed() || window.isVisible()) return')
    expect(windowManager).toContain("window.setVibrancy('under-window')")
  })

  it('does not put mica/acrylic on the Zen constructor path before first paint', () => {
    expect(windowManager).toContain('const zenEnabled = isZenShellEnabled()')
    expect(windowManager).toContain('!zenEnabled && windowsBackgroundMaterial')
  })

  it('SET_ZEN_SHELL validates the patch and never forwards BrowserWindow options', () => {
    expect(settingsHandlers).toContain('parseZenShellPatch')
    expect(settingsHandlers).toContain('SET_ZEN_SHELL')
    expect(settingsHandlers).toContain('GET_SHELL_SNAPSHOT')
    expect(settingsHandlers).toContain('peekZenShellSnapshot')
    expect(settingsHandlers).toContain('reapplyZenShellOnAllWindows')
    expect(settingsHandlers).not.toMatch(/setZenShell[\s\S]{0,400}BrowserWindow\(/)
  })

  it('Zen material apply is separated from show-once', () => {
    expect(shellMaterial).toContain('dispatch(window, record, { type: \'ready-to-show\' })')
    expect(shellMaterial).toContain('dispatch(window, record, { type: \'did-finish-load\' })')
    expect(shellMaterial).toContain('applyNativeMaterial')
    expect(shellMaterial).toContain('window.show()')
  })
})
