import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type AppearanceSettingsPageComponent from '../AppearanceSettingsPage'

const appearanceSettingsPath = join(__dirname, '../AppearanceSettingsPage.tsx')
const source = readFileSync(appearanceSettingsPath, 'utf8')

describe('AppearanceSettingsPage zoom default', () => {
  it('renders the fresh-install 90% value before asynchronous config loading resolves', () => {
    expect(source).toContain('const [defaultZoomLevel, setDefaultZoomLevel] = useState(90)')
    // Async capability behavior is exercised by desktop-appearance.test.ts.
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
  })

  it('keeps the current color theme in the menu when the preset catalog is empty', () => {
    expect(source).toContain('options.push({ value: colorTheme, label: colorTheme })')
    expect(source).toContain('!options.some(option => option.value === colorTheme)')
  })
})

// ============================================
// Material write seam
// ============================================

/**
 * The glass section owns one write seam: `window.electronAPI.setAppMaterial`
 * (AppearanceSettingsPage.tsx → MaterialEffectsSection#commit). It is debounced
 * by MATERIAL_APPLY_DEBOUNCE_MS and must fire exactly once per master-toggle
 * click, echoing `{ enabled: … }` — never `null` — because the field is only
 * cleared through the explicit reset action.
 *
 * The page cannot render against the real renderer runtime here: ThemeProvider
 * loads preset themes through Vite's `import.meta.glob`. The theme/app-shell
 * contexts, i18n, and the sibling appearance sections are stubbed and the
 * transport is synthetic, mirroring the happy-dom harness of the sibling
 * component suites.
 */
useDomForFile()

const pageDir = join(__dirname, '..')
const themeContextPath = join(pageDir, '../../context/ThemeContext.tsx')
const appShellContextPath = join(pageDir, '../../context/AppShellContext.tsx')
const panelHeaderPath = join(pageDir, '../../components/app-shell/PanelHeader.tsx')

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', changeLanguage: async () => {} },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}))

// The state the section renders when the user has a theme override with the
// material layer on.
const themeStub = {
  mode: 'dark',
  setMode: () => {},
  colorTheme: 'pier',
  setColorTheme: () => {},
  font: 'rox',
  setFont: () => {},
  chatFont: 'rox',
  setChatFont: () => {},
  terminalFont: 'jetbrains',
  setTerminalFont: () => {},
  contrast: 'system',
  setContrast: () => {},
  resolvedContrast: 'normal',
  activeWorkspaceId: null,
  workspaceColorTheme: null,
  setWorkspaceColorTheme: async () => true,
  resolvedMode: 'dark',
  systemPreference: 'dark',
  effectiveColorTheme: 'pier',
  previewColorTheme: null,
  setPreviewColorTheme: () => {},
  previewMode: null,
  setPreviewMode: () => {},
  effectiveColorThemeSource: 'app',
  themeResolvedFrom: 'none',
  themeLoadError: null,
  presetTheme: null,
  resolvedTheme: { material: { enabled: true } },
  isDark: true,
  isScenic: false,
  shikiTheme: 'pierre-dark',
  shikiConfig: {},
}

mock.module(themeContextPath, () => ({
  useTheme: () => themeStub,
  // `@/hooks/useTheme` re-exports the app-override subscription.
  useAppTheme: () => null,
}))
// Identity-stable: several sections subscribe with `workspaces` in effect
// dependencies, so a fresh array per render would re-run them forever.
const appShellStub = {
  workspaces: [],
  sessionStatuses: [],
  activeWorkspaceId: null,
}
const sessionOptionsStub = {}

mock.module(appShellContextPath, () => ({
  AppShellProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
  useAppShellContext: () => appShellStub,
  useOptionalAppShellContext: () => appShellStub,
  useSession: () => null,
  useActiveWorkspace: () => null,
  usePendingPermission: () => undefined,
  usePendingCredential: () => undefined,
  useSessionOptionsFor: () => sessionOptionsStub,
}))
// Header chrome pulls the motion/Drawer graphs, which are irrelevant to the seam.
mock.module(panelHeaderPath, () => ({
  PanelHeader: ({ title }: { title?: React.ReactNode }) =>
    React.createElement('header', null, title ?? null),
}))
// Sibling appearance sections render their own flag-gated surfaces.
for (const section of [
  'ZenShellSettings',
  'WorkbenchChromeSettings',
  'ConationShellSettings',
  'SuperEngineeringAppearanceSettings',
]) {
  mock.module(join(pageDir, `${section}.tsx`), () => ({
    [section]: () => null,
  }))
}

/**
 * Resolved by the transport when the section's debounced apply arrives.
 *
 * The apply debounce runs on happy-dom's window timer queue, which Bun's fake
 * timers cannot drive, so the tests await this real completion signal instead
 * of sleeping for a guessed duration.
 */
const writeWaiters: Array<(material: unknown) => void> = []

function applyMaterial(material: unknown): Promise<{ material: unknown }> {
  writeWaiters.shift()?.(material)
  return Promise.resolve({ material })
}

const setAppMaterial = mock(applyMaterial)

// Synthetic renderer transport. Not `electron`, so the desktop-only
// capabilities stay unavailable exactly as in the web renderer.
Object.assign(window, {
  electronAPI: {
    getRuntimeEnvironment: () => 'web',
    setAppMaterial,
  },
})

const MATERIAL_ENABLED_LABEL = 'settings.appearance.material.enabled'
const MATERIAL_SAVE_ERROR = 'settings.appearance.material.saveError'

/** Resolves when the section's debounced write reaches the transport. */
function nextWrite(): Promise<unknown> {
  const { promise, resolve } = Promise.withResolvers<unknown>()
  writeWaiters.push(resolve)
  return promise
}

/** The master switch of the glass section, located by its rendered label. */
function materialToggle(): HTMLButtonElement {
  const toggles = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="switch"]'))
  const toggle = toggles.find(element => {
    const labelledBy = element.getAttribute('aria-labelledby')
    return labelledBy !== null && document.getElementById(labelledBy)?.textContent === MATERIAL_ENABLED_LABEL
  })
  if (!toggle) throw new Error('material master toggle not found')
  return toggle
}

/** Loaded in `beforeAll` so the page sees the mocks registered above. */
let AppearanceSettingsPage: typeof AppearanceSettingsPageComponent

describe('material write seam', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  // Static import cannot work: the page module graph must load after the
  // context/i18n mocks above are registered.
  beforeAll(async () => {
    AppearanceSettingsPage = (await import('../AppearanceSettingsPage')).default
  })

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(AppearanceSettingsPage))
    })
  })

  afterEach(async () => {
    writeWaiters.length = 0
    setAppMaterial.mockClear()
    setAppMaterial.mockImplementation(applyMaterial)
    const mounted = root
    root = null
    if (mounted) await act(async () => { mounted.unmount() })
    resetDom()
  })

  /** Click the master toggle and await its debounced transport write. */
  async function clickMaterialToggle(): Promise<void> {
    const written = nextWrite()
    await act(async () => {
      materialToggle().click()
    })
    await act(async () => {
      await written
    })
  }

  it('writes enabled=false then enabled=true, once per master-toggle click', async () => {
    expect(materialToggle().getAttribute('aria-checked')).toBe('true')

    await clickMaterialToggle()

    expect(setAppMaterial).toHaveBeenCalledTimes(1)
    expect(setAppMaterial.mock.calls[0]?.[0]).toMatchObject({ enabled: false })
    expect(materialToggle().getAttribute('aria-checked')).toBe('false')

    await clickMaterialToggle()

    expect(setAppMaterial).toHaveBeenCalledTimes(2)
    expect(setAppMaterial.mock.calls[1]?.[0]).toMatchObject({ enabled: true })
    expect(materialToggle().getAttribute('aria-checked')).toBe('true')
  })

  it('reverts the draft to the last committed value when the write rejects', async () => {
    // The transport answers only when the test fails it, so the optimistic
    // draft is observable before the rejection lands.
    const { promise: writeAnswer, reject: failWrite } = Promise.withResolvers<{ material: unknown }>()
    setAppMaterial.mockImplementationOnce((material: unknown) => {
      writeWaiters.shift()?.(material)
      return writeAnswer
    })

    await clickMaterialToggle()

    // Optimistic draft: the switch moved before the transport answered.
    expect(materialToggle().getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      failWrite(new Error('synthetic material write failure'))
      await Promise.resolve()
    })

    expect(setAppMaterial).toHaveBeenCalledTimes(1)
    expect(materialToggle().getAttribute('aria-checked')).toBe('true')
    const alert = Array.from(document.querySelectorAll('[role="alert"]'))
      .find(element => element.textContent === MATERIAL_SAVE_ERROR)
    expect(alert).toBeDefined()
  })
})