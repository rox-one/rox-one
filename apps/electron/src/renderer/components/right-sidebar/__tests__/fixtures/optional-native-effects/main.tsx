import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { useNotifications } from '@/hooks/useNotifications'
import { syncMainProcessLanguage } from '@/lib/main-language-sync'
import type { SessionFile, Session } from '../../../../../../shared/types'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
await i18n.use(initReactI18next).init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const mode = new URLSearchParams(location.search).get('mode') ?? 'denied'
const calls: Array<{ method: string; value?: unknown }> = []
const record = (method: string, value?: unknown) => { calls.push({ method, value }) }
const held: Array<{ sessionId: string; resolve(files: SessionFile[]): void }> = []
let filesChanged: ((id: string) => void) | undefined
let reconnect: (() => void) | undefined
let focus: ((value: boolean) => void) | undefined
let lastFocus: ((value: boolean) => void) | undefined
let focusResolve: ((value: boolean) => void) | undefined
let toggle: (() => void) | undefined
let session: ((id: string) => void) | undefined
let deny = true
const file = (name: string): SessionFile => ({ name, path: '/synthetic/' + name, type: 'file' })
const api = Object.freeze({
  getSessionFiles: async (sessionId: string) => {
    record('getSessionFiles', sessionId)
    if (mode === 'held') return new Promise<SessionFile[]>(resolve => { held.push({ sessionId, resolve }) })
    return [file(sessionId + '.txt')]
  },
  watchSessionFiles: async (sessionId: string) => { record('watchSessionFiles', sessionId); throw { code: 'AUTH_FAILED' } },
  unwatchSessionFiles: async () => { record('unwatchSessionFiles'); throw { code: 'AUTH_FAILED' } },
  onSessionFilesChanged: (listener: (id: string) => void) => { filesChanged = listener; return () => { record('filesCleanup'); if (filesChanged === listener) filesChanged = undefined } },
  onReconnected: (listener: () => void) => { reconnect = listener; return () => { record('reconnectCleanup'); if (reconnect === listener) reconnect = undefined } },
  changeLanguage: async (value: string) => { record('changeLanguage', value); if (deny) throw { code: 'AUTH_FAILED' } },
  isChannelAvailable: () => true,
  getWindowFocusState: async () => { record('getWindowFocusState'); if (mode === 'focus-held') return new Promise<boolean>(resolve => { focusResolve = resolve }); return false },
  onWindowFocusChange: (listener: (value: boolean) => void) => { focus = lastFocus = listener; return () => { record('focusCleanup'); if (focus === listener) focus = undefined } },
  onNotificationNavigate: () => () => { record('navigationCleanup') },
  onBadgeDraw: () => () => { record('badgeCleanup') },
  onBadgeDrawWindows: () => () => { record('windowsBadgeCleanup') },
  refreshBadge: async () => { record('refreshBadge'); throw { code: 'AUTH_FAILED' } },
  showNotification: async (...args: unknown[]) => { record('showNotification', args); throw { code: 'AUTH_FAILED' } },
})
Object.assign(window, { electronAPI: api })
let stopLanguage = syncMainProcessLanguage(i18n, api as unknown as typeof window.electronAPI)
Object.assign(window, { __optionalNative: {
  calls,
  toggle: () => toggle?.(),
  session: (id: string) => { flushSync(() => session?.(id)) },
  changed: (id: string) => filesChanged?.(id),
  reconnect: () => reconnect?.(),
  resolve: (index: number, name: string) => held[index]?.resolve([file(name)]),
  held: () => held.map(item => item.sessionId),
  language: (value: string) => i18n.changeLanguage(value),
  allowLanguage: () => { deny = false },
  stopLanguage: () => { stopLanguage(); stopLanguage = () => {} },
  resolveFocus: (value: boolean) => focusResolve?.(value),
  focus: (value: boolean) => focus?.(value),
  capturedFocus: (value: boolean) => lastFocus?.(value),
} })
const context = { onOpenFile: () => {} } as unknown as AppShellContextType
function Notifications() {
  const state = useNotifications({ workspaceId: 'synthetic-workspace', enabled: true })
  return <><p data-testid="focus">{String(state.isWindowFocused)}</p><button onClick={() => state.showSessionNotification({ id: 'synthetic-session', name: 'Synthetic message' } as Session, 'Synthetic preview')}>Notify</button></>
}
function Fixture() {
  const [mounted, setMounted] = React.useState(true)
  const [sessionId, setSession] = React.useState('session-A')
  React.useEffect(() => { toggle = () => setMounted(value => !value); session = setSession; return () => { toggle = undefined; session = undefined } }, [])
  return <><p data-testid="ready">Actual optional native effects with denied synthetic transport</p><p data-testid="language">{i18n.language}</p><button onClick={() => setMounted(value => !value)}>Toggle</button>{mounted && <><AppShellProvider value={context}><div data-testid="files"><SessionFilesSection sessionId={sessionId} /></div></AppShellProvider><Notifications /></>}</>
}
createRoot(document.getElementById('root')!).render(mode === 'strict' ? <React.StrictMode><Fixture /></React.StrictMode> : <Fixture />)
