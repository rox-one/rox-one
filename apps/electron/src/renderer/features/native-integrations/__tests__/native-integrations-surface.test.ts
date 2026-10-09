/**
 * Static guarantees for the renderer native-integration surfaces: the frozen
 * `window.electronAPI` names live behind one bridge, contexts are gated, and no
 * user-visible string is hardcoded.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const renderer = join(import.meta.dir, '../../..')

const read = (...parts: string[]): string => readFileSync(join(renderer, ...parts), 'utf8')

const bridge = read('platform', 'native-integrations.ts')
const composer = read('features', 'native-integrations', 'QuickComposerSurface.tsx')
const shellActions = read('features', 'native-integrations', 'ShellActionBridge.tsx')
const settingsSection = read('pages', 'settings', 'NativeIntegrationsSettingsSection.tsx')
const fileActions = read('platform', 'native-file-actions.tsx')
const fileTree = read('components', 'right-sidebar', 'SessionFilesSection.tsx')
const main = read('main.tsx')
const app = read('App.tsx')

const CYRILLIC = /[А-Яа-яЁё]/

describe('renderer native integrations', () => {
  it('names the frozen channels only in the bridge', () => {
    for (const member of [
      'quickComposer', 'appIntegration', 'revealInFinder', 'openPath', 'copyPath',
      'quickLook', 'quickLookClose', 'startDrag', 'onShellAction',
    ]) {
      expect(bridge).toContain(member)
    }
    // Consumers go through the bridge, never window.electronAPI.<frozen> directly.
    expect(composer).not.toContain('window.electronAPI.quickComposer')
    expect(settingsSection).not.toContain('window.electronAPI.quickComposer')
    expect(settingsSection).not.toContain('window.electronAPI.appIntegration')
  })

  it('renders the composer without the app shell and with t() copy', () => {
    expect(main).toContain("=== 'quick-composer'")
    expect(main).toContain('QuickComposerSurface')
    for (const key of ['quickComposer.modeNote', 'quickComposer.modeTask', 'quickComposer.saveNote', 'quickComposer.saveTask']) {
      expect(composer).toContain(key)
    }
    expect(CYRILLIC.test(composer)).toBe(false)
  })

  it('handles every shell:action kind and gates the settings writes', () => {
    for (const action of ['new-note', 'new-task', 'quick-composer', 'open-inbox', 'navigate']) {
      expect(shellActions).toContain(`case '${action}'`)
    }
    expect(app).toContain('<ShellActionBridge />')
    expect(settingsSection).toContain('settingsPageActionAllowed')
    expect(settingsSection).toContain("source: settingsRuntimeSource()")
    expect(CYRILLIC.test(settingsSection)).toBe(false)
  })

  it('exposes Finder/QuickLook/drag only for real filesystem paths', () => {
    expect(fileActions).toContain('isFilesystemPath')
    expect(fileActions).toContain('isMac')
    expect(fileActions).toContain('startDrag')
    expect(fileTree).toContain('NativeFileExtraMenuItems')
    expect(fileTree).toContain('useQuickLookOnSpace')
    expect(fileTree).toContain('nativeFileDragProps')
    expect(CYRILLIC.test(fileActions)).toBe(false)
  })
})