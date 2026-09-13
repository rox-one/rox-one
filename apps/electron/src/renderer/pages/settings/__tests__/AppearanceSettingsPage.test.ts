import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appearanceSettingsPath = join(__dirname, '../AppearanceSettingsPage.tsx')
const source = readFileSync(appearanceSettingsPath, 'utf8')

describe('AppearanceSettingsPage zoom default', () => {
  it('renders the fresh-install 90% value before asynchronous config loading resolves', () => {
    expect(source).toContain('const [defaultZoomLevel, setDefaultZoomLevel] = useState(90)')
    expect(source).toContain('window.electronAPI?.getDefaultZoomLevel?.().then(setDefaultZoomLevel)')
  })

  it('always mounts workbench and Conation sections so settings is not blank with only shell+inspector on', () => {
    expect(source).toContain('<ZenShellSettings />')
    expect(source).toContain('<WorkbenchChromeSettings />')
    expect(source).toContain('<ConationShellSettings />')
    expect(source).not.toMatch(/unifiedShell\s*&&\s*<WorkbenchChromeSettings/)
    expect(source).not.toMatch(/inspector\s*&&\s*<ConationShellSettings/)
  })

  it('exposes an app-wide high-contrast control for dark and light themes', () => {
    expect(source).toContain('settings.appearance.contrast')
    expect(source).toContain('settings.appearance.contrastHigh')
    expect(source).toContain('setContrast')
  })

  it('exposes independent UI, chat, and terminal font controls', () => {
    expect(source).toContain('settings.appearance.fontUi')
    expect(source).toContain('settings.appearance.fontChat')
    expect(source).toContain('settings.appearance.fontTerminal')
    expect(source).toContain('settings.appearance.fontRox')
    expect(source).toContain('settings.appearance.fontJetbrains')
    expect(source).toContain('setChatFont')
    expect(source).toContain('setTerminalFont')
  })

  it('keeps Zen Shell behind shell.zen.v1 with default OFF', () => {
    const zen = readFileSync(join(__dirname, '../ZenShellSettings.tsx'), 'utf8')
    expect(zen).toContain("flag: 'shell.zen.v1'")
    expect(zen).toContain('enabled: false')
    expect(source).toContain('<ZenShellSettings />')
  })

  it('does not throw when playground IPC is missing preset themes or tool icons', () => {
    expect(source).toContain('window.electronAPI.loadPresetThemes?.()')
    expect(source).toContain('window.electronAPI.getToolIconMappings?.()')
    expect(source).toContain('window.electronAPI.getHomeDir?.()')
  })

  it('keeps the current color theme in the menu when the preset catalog is empty', () => {
    expect(source).toContain('options.push({ value: colorTheme, label: colorTheme })')
    expect(source).toContain('!options.some(option => option.value === colorTheme)')
  })
})
