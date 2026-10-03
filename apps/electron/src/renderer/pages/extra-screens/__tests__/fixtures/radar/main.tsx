import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import RadarPage from '../../../radar/RadarPage'
import { EXTRA_SCREEN_STORAGE_EVENT, workspaceStorageKey } from '@/lib/extra-screens/storage'
import { emptyRadarData } from '../../../radar/radar-model'
import type { ElectronAPI } from '../../../../../../shared/types'

await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const calls: { method: string; value: unknown }[] = []
let workspaceId = 'workspace-A'
let mode = 'success'
let createGate: ReturnType<typeof Promise.withResolvers<{ id: string }>> | undefined
const publishedAt = Date.now() - 60_000
const storedKey = workspaceStorageKey('radar', workspaceId)
if (!localStorage.getItem(storedKey)) localStorage.setItem(storedKey, JSON.stringify(emptyRadarData()))
window.electronAPI = {
  getWindowWorkspace: async () => workspaceId,
  getSources: async () => [
    { config: { slug: 'brave', name: 'Brave Search', enabled: true, connectionStatus: 'connected' } },
    { config: { slug: 'exa', name: 'Exa', enabled: true, connectionStatus: 'connected' } },
    { config: { slug: 'disabled', name: 'Disconnected search', enabled: false, connectionStatus: 'needs_auth' } },
  ],
  listNotes: async () => [], listMeetings: async () => [],
  feedList: async () => ({ items: [], sources: [], x: { state: 'disconnected' } }), onFeedChanged: () => () => {},
  async createSession(owner: string, options: unknown) {
    calls.push({ method: 'createSession', value: { owner, options } })
    if (mode === 'start-failed') throw new Error('Synthetic unavailable provider')
    if (mode === 'deferred') { createGate = Promise.withResolvers<{ id: string }>(); return createGate.promise }
    return { id: 'session-' + calls.filter(call => call.method === 'createSession').length }
  },
  async sendMessage(id: string, prompt: string) { calls.push({ method: 'sendMessage', value: { id, prompt } }) },
  async getSessionMessages(id: string) {
    calls.push({ method: 'getSessionMessages', value: id })
    if (mode === 'running') return { isProcessing: true, messages: [] }
    if (mode === 'empty') return { isProcessing: false, messages: [] }
    return { isProcessing: false, messages: [{ role: 'assistant', timestamp: Date.now(), content: JSON.stringify({ items: [
      { title: 'Synthetic source-backed release', source: 'Brave Search', sourceSlug: 'brave', topic: 'Rox releases', publishedAt: new Date(publishedAt).toISOString(), bucket: 'reaction', url: 'https://example.test/release', summary: 'Synthetic fixture result with a real-shaped source and publication date.', reaction: 'Review the release' },
      { title: 'Synthetic important update', source: 'Exa', sourceSlug: 'exa', topic: 'Rox releases', publishedAt: new Date(publishedAt).toISOString(), bucket: 'important', url: 'https://example.test/update', summary: 'Second source-backed result.' },
    ] }) }] }
  },
  async cancelProcessing(id: string) { calls.push({ method: 'cancelProcessing', value: id }) },
  async openUrl(url: string) { calls.push({ method: 'openUrl', value: url }) },
} as unknown as ElectronAPI

Object.assign(window, { __radarFixture: {
  calls, publishedAt, mode(value: string) { mode = value }, resolveCreate() { createGate?.resolve({ id: 'stale-created' }) },
  ageSweep() {
    const key = workspaceStorageKey('radar', workspaceId)
    const data = JSON.parse(localStorage.getItem(key)!)
    if (data.sweeps[0]) data.sweeps[0].startedAt = Date.now() - 20_000
    localStorage.setItem(key, JSON.stringify(data))
    window.dispatchEvent(new CustomEvent(EXTRA_SCREEN_STORAGE_EVENT, { detail: { key } }))
  },
  switchWorkspace(value: string) { workspaceId = value; window.dispatchEvent(new CustomEvent('fixture-workspace', { detail: value })) },
} })
function Fixture() {
  const [itemId, setItemId] = useState<string | null>(null)
  const [activeWorkspaceId, setWorkspace] = useState(workspaceId)
  useEffect(() => {
    const navigate = (event: Event) => {
      const route = (event as CustomEvent<{ route: string }>).detail.route
      if (route.startsWith('radar')) setItemId(route.includes('/item/') ? decodeURIComponent(route.split('/item/')[1]!) : null)
    }
    const change = (event: Event) => { setWorkspace((event as CustomEvent<string>).detail); setItemId(null) }
    window.addEventListener('craft-agent-navigate', navigate); window.addEventListener('fixture-workspace', change)
    return () => { window.removeEventListener('craft-agent-navigate', navigate); window.removeEventListener('fixture-workspace', change) }
  }, [])
  const shell = { activeWorkspaceId, workspaces: ['workspace-A', 'workspace-B'].map(id => ({ id, slug: id, name: id, rootPath: '/synthetic/' + id, createdAt: 1 })),
    llmConnections: [], pendingPermissions: new Map(), pendingCredentials: new Map() } as unknown as AppShellContextType
  return <I18nextProvider i18n={i18n}><AppShellProvider value={shell}><main style={{ height: '100vh' }}><RadarPage itemId={itemId} /></main></AppShellProvider></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
