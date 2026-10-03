import React from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, Provider, useAtomValue } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { ThemeProvider, useTheme } from '@/context/ThemeContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { useShellAppearance } from '@/hooks/useShellAppearance'
import { panelStackAtom } from '@/atoms/panel-stack'
import { bottomDockHeightAtom, bottomTerminalOpenAtom } from '@/atoms/unified-shell'
import { BottomTerminalDock } from '@/components/session-inspector/BottomTerminalDock'
import { PanelResizeSash } from '../../PanelResizeSash'
import { PANEL_GAP, PANEL_EDGE_INSET, PANEL_STACK_TOP_INSET, PANEL_STACK_BOTTOM_INSET } from '../../panel-constants'
import { InputContainer } from '../../input/InputContainer'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SettingsCard, SettingsCardContent } from '@/components/settings/SettingsCard'
import { ZenShellSettings } from '@/pages/settings/ZenShellSettings'
import { ShikiThemeProvider } from '../../../../../../../../packages/ui/src/context/ShikiThemeContext'
import { TooltipProvider } from '../../../../../../../../packages/ui/src/components/tooltip'
import { CodeBlock } from '../../../../../../../../packages/ui/src/components/markdown/CodeBlock'
import { snapshotZenShell, type ZenShellSnapshot } from '../../../../../shared/shell-appearance'
import type { ThemeFile, ThemeOverrides } from '@config/theme'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'

const query = new URLSearchParams(location.search)
const themeId = query.get('theme') ?? 'nordfox-opaque'
const runtime = query.get('runtime') === 'electron' ? 'electron' : 'web'
const themes = import.meta.glob('../../../../../../resources/themes/*.json', { eager: true, import: 'default' }) as Record<string, ThemeFile>
const byId = new Map(Object.entries(themes).map(([path, theme]) => [path.split('/').pop()!.replace('.json', ''), theme]))
const calls: { method: string; value?: unknown }[] = []
let rejectSave = false
const shellListeners = new Set<(snapshot: ZenShellSnapshot) => void>()
const appThemeListeners = new Set<(theme: ThemeOverrides | null) => void>()
const themePreferenceListeners = new Set<(theme: Record<string, unknown>) => void>()
let colorRead: ((value: string) => void) | undefined
let appRead: ((value: ThemeOverrides | null) => void) | undefined
let workspaceRead: ((value: string | null) => void) | undefined
const shellSnapshot = (fallback?: string): ZenShellSnapshot => snapshotZenShell({
  zenEnabled: fallback !== 'zen-disabled',
  preference: fallback === 'user-opaque' ? 'opaque' : 'system',
  platform: 'darwin',
  reduceTransparency: fallback === 'reduce-transparency',
  highContrast: fallback === 'high-contrast',
  paintHealthy: fallback !== 'no-healthy-paint',
  windowDestroyed: false,
  gpuFailed: fallback === 'gpu-failure',
})

// Only transport is synthetic. It has no native compositor, server, workspace
// or persistent application configuration. Acknowledged writes are saved in
// fixture localStorage to exercise ThemeProvider's real reload/preview logic.
const api = {
  getRuntimeEnvironment: () => runtime,
  getColorTheme: async () => query.get('deferred') === 'config' ? new Promise<string>(resolve => { colorRead = resolve }) : localStorage.getItem('fixture-config-theme') ?? themeId,
  getAppTheme: async () => query.get('deferred') === 'app' ? new Promise<ThemeOverrides | null>(resolve => { appRead = resolve }) : null,
  onAppThemeChange: (listener: (theme: ThemeOverrides | null) => void) => { appThemeListeners.add(listener); return () => { appThemeListeners.delete(listener) } },
  onThemePreferencesChange: (listener: (theme: Record<string, unknown>) => void) => { themePreferenceListeners.add(listener); return () => { themePreferenceListeners.delete(listener) } },
  getWorkspaceColorTheme: async () => query.get('deferred') === 'workspace' ? new Promise<string | null>(resolve => { workspaceRead = resolve }) : null,
  setWorkspaceColorTheme: async (_workspace: string, value: string | null) => { calls.push({ method: 'setWorkspaceColorTheme', value }) },
  loadPresetTheme: async (id: string) => ({ theme: byId.get(id) ?? null }),
  setColorTheme: async (value: string) => {
    calls.push({ method: 'setColorTheme', value })
    if (rejectSave) throw new Error('synthetic theme save rejection')
    localStorage.setItem('fixture-config-theme', value)
  },
  broadcastThemePreferences: (value: unknown) => { calls.push({ method: 'broadcastThemePreferences', value }) },
  getShellSnapshot: async () => {
    if (query.get('snapshot') === 'unavailable') throw new Error('synthetic shell capability unavailable')
    return shellSnapshot(query.get('snapshot') ?? undefined)
  },
  onShellChanged: (listener: (snapshot: ZenShellSnapshot) => void) => { shellListeners.add(listener); return () => { shellListeners.delete(listener) } },
  getAutoCapitalisation: async () => false,
  getSendMessageKey: async () => 'enter',
  getSpellCheck: async () => false,
  runShellCommand: async (value: { command: string; cwd?: string }) => {
    calls.push({ method: 'runShellCommand', value })
    return { ok: true, stdout: '\u001b[32mfixture ANSI output\u001b[0m', stderr: '' }
  },
}
if (query.get('presetTransport') === 'absent') delete (api as Partial<typeof api>).loadPresetTheme
window.electronAPI = api as unknown as typeof window.electronAPI
const fixture = {
  calls,
  theme: {} as Record<string, unknown>,
  rejectSave(value: boolean) { rejectSave = value },
  emitShell(fallback?: string) { for (const listener of shellListeners) listener(shellSnapshot(fallback)) },
  emitAppTheme(value: ThemeOverrides | null) { for (const listener of appThemeListeners) listener(value) },
  emitThemePreference(value: string) { for (const listener of themePreferenceListeners) listener({ colorTheme: value, mode: 'system', font: 'rox', contrast: 'system' }) },
  resolveConfig(value: string) { if (!colorRead) throw new Error('No pending configuration read'); colorRead(value) },
  resolveApp(value: ThemeOverrides | null) { if (!appRead) throw new Error('No pending app override read'); appRead(value) },
  resolveWorkspace(value: string | null) { if (!workspaceRead) throw new Error('No pending workspace read'); workspaceRead(value) },
  selectTheme: (_id: string) => {},
  selectWorkspaceTheme: (_id: string) => Promise.resolve(false),
}
;(window as unknown as { __zedAppearanceFixture: typeof fixture }).__zedAppearanceFixture = fixture

const translationsReady = i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })

const store = createStore()
store.set(panelStackAtom, [
  { id: 'fixture-left', route: 'allSessions', proportion: 0.5, panelType: 'session', laneId: 'main' },
  { id: 'fixture-right', route: 'settings', proportion: 0.5, panelType: 'settings', laneId: 'main' },
])
store.set(bottomDockHeightAtom, 104)
store.set(bottomTerminalOpenAtom, true)

function AppearanceFixture() {
  useShellAppearance()
  const theme = useTheme()
  fixture.selectTheme = theme.setColorTheme
  fixture.selectWorkspaceTheme = theme.setWorkspaceColorTheme
  const panels = useAtomValue(panelStackAtom)
  const [compactNavigator, setCompactNavigator] = React.useState(false)
  fixture.theme = {
    colorTheme: theme.colorTheme, effectiveColorTheme: theme.effectiveColorTheme,
    effectiveColorThemeSource: theme.effectiveColorThemeSource, resolvedMode: theme.resolvedMode,
    systemPreference: theme.systemPreference, themeResolvedFrom: theme.themeResolvedFrom,
    themeLoadError: theme.themeLoadError, shikiTheme: theme.shikiTheme,
  }
  return <ShikiThemeProvider shikiTheme={theme.shikiTheme}><TooltipProvider>
    <main data-testid="appearance-fixture" data-fixture="production-components-synthetic-transport" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="chrome-topbar rox-shell-divider-b" data-testid="topbar" style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center' }}>
        <strong>Appearance regression fixture</strong>
        <span>Production components · synthetic transport</span>
        <Button data-testid="control" variant="secondary" onClick={() => theme.setContrast(theme.contrast === 'high' ? 'normal' : 'high')}>Toggle contrast</Button>
        <Button data-testid="toggle-compact-navigator" variant="secondary" onClick={() => setCompactNavigator(value => !value)}>Toggle compact navigator fixture</Button>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 640 }}>
        <aside className="rox-shell-pane rox-shell-divider-r" data-panel-role="sidebar" data-testid="sidebar" style={{ width: 200, flexShrink: 0 }}>
          {/* Match PanelStackContainer's outer material -> width wrapper ->
              chrome child nesting to catch accidental double tint/blur. */}
          <div className="h-full" style={{ width: 199 }}><div className="chrome-rail h-full" data-testid="sidebar-inner" style={{ padding: 12 }}>
            <p>Fixture navigation</p>
            {['nordfox-opaque', 'min-dark-blurred', 'siri-light'].map(id => <div key={id} style={{ marginTop: 8 }}><Button variant="secondary" data-testid={`choose-${id}`} onClick={() => theme.setColorTheme(id)}>{byId.get(id)?.name}</Button></div>)}
            <Button data-testid="preview-siri" variant="ghost" onClick={() => theme.setPreviewColorTheme('siri-light')}>Preview Siri</Button>
            <Button data-testid="cancel-preview" variant="ghost" onClick={() => theme.setPreviewColorTheme(null)}>Cancel preview</Button>
          </div></div>
        </aside>
        <aside className="rox-shell-pane rox-shell-divider-r" data-panel-role="navigator" data-testid="navigator" style={{ width: 180, flexShrink: 0 }}>
          {compactNavigator
            ? <div className="chrome-strip h-full" data-testid="navigator-inner" style={{ width: 179, padding: 12 }}>Fixture compact navigator</div>
            : <div className="h-full" style={{ width: 179 }}><div className="chrome-strip h-full" data-testid="navigator-inner" style={{ padding: 12 }}>Fixture item navigator</div></div>}
        </aside>
        {/* These labelled layout wrappers use the production panel tokens and
            state. Actual AppShell route orchestration is verified separately. */}
        <div data-testid="panel-row" style={{ display: 'flex', flex: 1, minWidth: 0, gap: PANEL_GAP, padding: `${PANEL_STACK_TOP_INSET}px ${PANEL_EDGE_INSET}px ${PANEL_STACK_BOTTOM_INSET}px` }}>
          <section id="fixture-left" className="rox-shell-pane" data-panel-role="content" data-testid="work-panel" style={{ flex: `${panels[0]?.proportion} 1 0px`, minWidth: 440 }}><div style={{ padding: 16 }}>
            <h1>Document surface</h1>
            <div data-testid="card"><SettingsCard><SettingsCardContent>Module card in the selected palette</SettingsCardContent></SettingsCard></div>
            <div data-testid="code" style={{ marginTop: 16 }}><CodeBlock code={'// Theme regression\nconst surface = { solid: true, radius: 4 };\nconsole.log(surface);'} language="typescript" /></div>
            <div data-testid="composer" style={{ marginTop: 24 }}><InputContainer currentModel="rox/standard" onModelChange={() => {}} onSubmit={() => {}} compactMode showCloudRunsChip={false} placeholder="Fixture composer" /></div>
          </div></section>
          <PanelResizeSash leftIndex={0} rightIndex={1} />
          <section id="fixture-right" className="rox-shell-pane rox-shell-divider-l" data-panel-role="content" data-testid="second-panel" style={{ flex: `${panels[1]?.proportion} 1 0px`, minWidth: 440 }}><div style={{ padding: 16 }}>
            <h2>Reading surface</h2><p>The work area stays solid while chrome uses a separate material policy.</p>
            <div data-testid="shell-settings"><ZenShellSettings /></div>
            <Popover><PopoverTrigger asChild><Button data-testid="open-popover" variant="secondary">Open menu</Button></PopoverTrigger><PopoverContent data-testid="popover">Detached menu surface</PopoverContent></Popover>
            <Dialog><DialogTrigger asChild><Button data-testid="open-dialog" variant="secondary">Open dialog</Button></DialogTrigger><DialogContent data-testid="dialog"><DialogTitle>Fixture dialog</DialogTitle><DialogDescription>Detached surface with production styles.</DialogDescription></DialogContent></Dialog>
          </div></section>
        </div>
        <aside className="rox-shell-pane rox-shell-divider-l" data-inspector-panel data-testid="inspector" style={{ width: 160, flexShrink: 0, padding: 12 }}>Fixture inspector</aside>
      </div>
      <BottomTerminalDock />
      <footer className="chrome-strip rox-shell-divider-t" data-testid="strip" style={{ padding: 12 }}>Selected: <output data-testid="theme-state">{theme.effectiveColorTheme} · {theme.resolvedMode} · {theme.themeResolvedFrom}</output></footer>
    </main>
  </TooltipProvider></ShikiThemeProvider>
}

const fixtureShellContext = { workspaces: [], activeWorkspaceId: null, activeWorkspaceSlug: null, llmConnections: [], enabledSources: [], skills: [], labels: [], isFocusedPanel: true } as unknown as AppShellContextType
void translationsReady.then(() => createRoot(document.getElementById('root')!).render(<Provider store={store}><ThemeProvider defaultMode="system" defaultColorTheme={themeId} activeWorkspaceId={query.get('deferred') === 'workspace' ? 'fixture-workspace' : null}><AppShellProvider value={fixtureShellContext}><EscapeInterruptProvider><AppearanceFixture /></EscapeInterruptProvider></AppShellProvider></ThemeProvider></Provider>))
