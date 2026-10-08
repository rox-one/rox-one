import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { chromium } from '@playwright/test'
import { join } from 'path'
import type { PresetTheme, ThemeOverrides } from '@config/theme'

type PreviewMode = 'light' | 'dark' | 'system' | null

interface ThemeProviderTestHarness {
  render: (props: Record<string, unknown>) => Promise<{ css: string; state: Record<string, unknown> }>
  preview: (theme: string | null) => Promise<{ css: string; state: Record<string, unknown> }>
  previewMode: (mode: PreviewMode) => Promise<{ state: Record<string, unknown>; persisted: boolean; broadcastCount: number }>
  startAppThemeSync: () => Promise<void>
  dispatchAppThemeChange: (theme: ThemeOverrides | null) => Promise<void>
  resolveInitialAppTheme: (theme: ThemeOverrides | null) => Promise<void>
  appThemeState: () => ThemeOverrides | null
}

declare global {
  interface Window {
    __themeProviderTest: ThemeProviderTestHarness
  }
}

/**
 * These tests deliberately use the existing Vite + Chrome setup instead of a
 * source-text assertion. ThemeProvider's contract is the style element it
 * writes to the renderer DOM, and Vite also transforms its import.meta.glob
 * preset loader exactly as the application does.
 */
const repoRoot = join(import.meta.dir, '..', '..', '..', '..', '..', '..')
const port = 5400 + (process.pid % 1000)
const baseUrl = `http://127.0.0.1:${port}`
const serverStartupTimeoutMs = 60_000
const browserLifecycleTimeoutMs = 120_000

let viteProcess: ReturnType<typeof Bun.spawn>
let browser: Awaited<ReturnType<typeof chromium.launch>>
let page: Awaited<ReturnType<typeof browser.newPage>>

async function waitForServer() {
  let lastError: unknown

  for (let elapsed = 0; elapsed < serverStartupTimeoutMs; elapsed += 250) {
    try {
      const response = await fetch(`${baseUrl}/playground.html`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(250)
  }

  throw new Error(`Vite theme test server did not start: ${String(lastError)}`)
}

beforeAll(async () => {
  viteProcess = Bun.spawn({
    cmd: [
      join(repoRoot, 'node_modules', '.bin', 'vite'),
      'dev',
      '--config',
      'apps/electron/vite.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env, CRAFT_VITE_PORT: String(port) },
  })

  await waitForServer()
  browser = await chromium.launch({ channel: 'chrome' })
  page = await browser.newPage()

  // The page merely establishes Vite's browser origin. Its full playground
  // bundle is intentionally not needed for this focused provider harness.
  await page.route('**/playground.tsx', route => route.abort())
  await page.goto(`${baseUrl}/playground.html`, { waitUntil: 'domcontentloaded' })

  await page.evaluate(async () => {
    // Vite resolves these browser-only virtual modules at runtime. Keeping the
    // specifiers dynamic prevents tsc from treating them as filesystem imports.
    const importFromVite = (specifier: string) => import(/* @vite-ignore */ specifier)
    const reactModule = await importFromVite('/@id/react')
    const React = reactModule.default ?? reactModule
    const reactDomModule = await importFromVite('/@id/react-dom/client')
    const createRoot = reactDomModule.createRoot ?? reactDomModule.default?.createRoot
    if (!createRoot) throw new Error('Vite did not expose ReactDOM.createRoot')
    const { ThemeProvider, useTheme } = await importFromVite('/context/ThemeContext.tsx')
    const { useAppTheme } = await importFromVite('/hooks/useTheme.ts')

    const container = document.createElement('div')
    document.body.appendChild(container)
    let root = createRoot(container)
    let themeContext: ReturnType<typeof useTheme> | undefined
    const appThemeContainer = document.createElement('div')
    document.body.appendChild(appThemeContainer)
    let appThemeRoot = createRoot(appThemeContainer)
    let appTheme: ReturnType<typeof useAppTheme> | undefined
    let resolveInitialAppTheme: ((theme: ThemeOverrides | null) => void) | undefined
    let appThemeChangeListener: ((theme: ThemeOverrides | null) => void) | undefined

    function Probe() {
      themeContext = useTheme()
      return null
    }

    const nextFrames = async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      await Promise.resolve()
    }

    window.__themeProviderTest = {
      async render(props) {
        // React preserves useState across renders of the same provider. Each
        // case models a fresh renderer boot, so recreate the root to exercise
        // the supplied defaultColorTheme rather than a prior test's state.
        root.unmount()
        root = createRoot(container)
        document.getElementById('craft-theme-overrides')?.remove()
        themeContext = undefined
        root.render(React.createElement(ThemeProvider, props, React.createElement(Probe)))
        await nextFrames()
        await nextFrames()

        const context = themeContext
        if (!context) throw new Error('ThemeProvider did not render the probe')

        return {
          css: document.getElementById('craft-theme-overrides')?.textContent ?? '',
          state: {
            effectiveColorTheme: context.effectiveColorTheme,
            effectiveColorThemeSource: context.effectiveColorThemeSource,
            resolvedTheme: context.resolvedTheme,
          },
        }
      },
      async preview(theme) {
        if (!themeContext) throw new Error('ThemeProvider must be rendered before setting a preview')
        themeContext.setPreviewColorTheme(theme)
        await nextFrames()

        return {
          css: document.getElementById('craft-theme-overrides')?.textContent ?? '',
          state: {
            effectiveColorTheme: themeContext.effectiveColorTheme,
            effectiveColorThemeSource: themeContext.effectiveColorThemeSource,
            resolvedTheme: themeContext.resolvedTheme,
          },
        }
      },
      async previewMode(mode) {
        if (!themeContext) throw new Error('ThemeProvider must be rendered before setting a preview mode')
        const persistedBefore = localStorage.getItem('craft-theme')
        let broadcastCount = 0
        window.electronAPI = {
          ...window.electronAPI,
          broadcastThemePreferences: async () => {
            broadcastCount += 1
          },
        }
        themeContext.setPreviewMode(mode)
        await nextFrames()

        return {
          state: {
            mode: themeContext.mode,
            previewMode: themeContext.previewMode,
            resolvedMode: themeContext.resolvedMode,
          },
          persisted: localStorage.getItem('craft-theme') === persistedBefore,
          broadcastCount,
        }
      },
      async startAppThemeSync() {
        appThemeRoot.unmount()
        appThemeRoot = createRoot(appThemeContainer)
        appTheme = undefined
        resolveInitialAppTheme = undefined
        appThemeChangeListener = undefined
        window.electronAPI = {
          ...window.electronAPI,
          getAppTheme: () => new Promise<ThemeOverrides | null>(resolve => {
            resolveInitialAppTheme = resolve
          }),
          onAppThemeChange: callback => {
            appThemeChangeListener = callback
            return () => {
              appThemeChangeListener = undefined
            }
          },
        }

        function AppThemeProbe() {
          appTheme = useAppTheme()
          return null
        }

        appThemeRoot.render(React.createElement(AppThemeProbe))
        await nextFrames()
      },
      async dispatchAppThemeChange(theme) {
        if (!appThemeChangeListener) throw new Error('App theme change listener was not registered')
        appThemeChangeListener(theme)
        await nextFrames()
      },
      async resolveInitialAppTheme(theme) {
        if (!resolveInitialAppTheme) throw new Error('Initial app theme request was not registered')
        resolveInitialAppTheme(theme)
        await nextFrames()
      },
      appThemeState() {
        return appTheme ?? null
      },
    }
  })
}, browserLifecycleTimeoutMs)

afterAll(async () => {
  try {
    await browser?.close()
  } catch {
    // Bun may already have closed a browser when aborting a failed setup hook.
  } finally {
    viteProcess?.kill(9)
    await Promise.race([viteProcess?.exited, Bun.sleep(3_000)])
  }
}, 15_000)

async function renderTheme(props: Record<string, unknown>) {
  return page.evaluate(({ props, presetThemes }) => {
    window.electronAPI = {
      ...window.electronAPI,
      getWorkspaceColorTheme: async () => 'workspace',
      loadPresetTheme: async (themeId: string) => presetThemes[themeId] ?? null,
    }
    return window.__themeProviderTest.render(props)
  }, {
    props,
    presetThemes: {
      preset: { id: 'preset', path: '/themes/preset.json', theme: { background: '#112233', foreground: '#f0f0f0', accent: '#445566', dark: { background: '#101820', foreground: '#e8edf2', accent: '#223344' } } },
      app: { id: 'app', path: '/themes/app.json', theme: { accent: '#101010' } },
      workspace: { id: 'workspace', path: '/themes/workspace.json', theme: { accent: '#202020' } },
      preview: { id: 'preview', path: '/themes/preview.json', theme: { accent: '#303030' } },
    } as Record<string, PresetTheme>,
  })
}

describe('app theme overrides at renderer runtime', () => {
  it('injects app-only CSS variables with the default preset selection', async () => {
    const result = await renderTheme({
      defaultColorTheme: 'default',
      defaultMode: 'light',
      appTheme: { background: '#f7f8fa', accent: '#13579b' },
    })

    expect(result.css).toContain('--background: #f7f8fa;')
    expect(result.css).toContain('--accent: #13579b;')
    expect(result.state.effectiveColorTheme).toBe('default')
  })

  it('deep-merges app dark tokens over a loaded preset before injecting CSS', async () => {
    const result = await renderTheme({
      defaultColorTheme: 'preset',
      defaultMode: 'dark',
      appTheme: { dark: { accent: '#ab12cd' } },
    })

    // The app value wins, while independent preset dark values survive.
    expect(result.css).toContain('--accent: #ab12cd;')
    expect(result.css).toContain('--background: #101820;')
    expect(result.css).toContain('--foreground: #e8edf2;')
  })

  it('keeps preview over workspace over the app-level preset selection', async () => {
    const workspace = await renderTheme({
      defaultColorTheme: 'app',
      activeWorkspaceId: 'workspace-id',
    })
    expect(workspace.state.effectiveColorTheme).toBe('workspace')
    expect(workspace.state.effectiveColorThemeSource).toBe('workspace')

    const preview = await page.evaluate(() => window.__themeProviderTest.preview('preview'))
    expect(preview.state.effectiveColorTheme).toBe('preview')
    expect(preview.state.effectiveColorThemeSource).toBe('preview')
    expect(preview.css).toContain('--accent: #303030;')
  })

  it('uses story preview mode without persisting or broadcasting user preferences', async () => {
    await renderTheme({ defaultColorTheme: 'default', defaultMode: 'light' })

    const preview = await page.evaluate(() => window.__themeProviderTest.previewMode('dark'))
    expect(preview.state).toEqual({ mode: 'light', previewMode: 'dark', resolvedMode: 'dark' })
    expect(preview.persisted).toBe(true)
    expect(preview.broadcastCount).toBe(0)

    const cleared = await page.evaluate(() => window.__themeProviderTest.previewMode(null))
    expect(cleared.state).toEqual({ mode: 'light', previewMode: null, resolvedMode: 'light' })
  })

  it('does not let a stale bootstrap app theme overwrite a newer IPC update', async () => {
    await page.evaluate(() => window.__themeProviderTest.startAppThemeSync())
    await page.evaluate(() => window.__themeProviderTest.dispatchAppThemeChange({ accent: '#live' }))
    await page.evaluate(() => window.__themeProviderTest.resolveInitialAppTheme({ accent: '#stale' }))

    const result = await page.evaluate(() => window.__themeProviderTest.appThemeState())
    expect(result).toEqual({ accent: '#live' })
  })
})
