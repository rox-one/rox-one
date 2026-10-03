import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { TooltipProvider } from '@rox/ui'
import { AppShellProvider } from '@/context/AppShellContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { CompactModelSelector } from '../../../CompactModelSelector'
import { FreeFormInput } from '../../../FreeFormInput'
import RuntimeSettingsPage from '@/pages/settings/RuntimeSettingsPage'
import { useSessionModelCatalog } from '@/hooks/useSessionModelCatalog'
import type { SessionModelCatalog, StartupRuntimeSummary } from '@rox/shared/protocol'
import en from '../../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'

// Public catalog responses are synthetic; all three rendered surfaces are production components.
// The fixture deliberately supplies no connection accounts or credential readiness.
const query = new URLSearchParams(location.search)
const calls: Array<{ method: string; args?: unknown }> = []
const catalog: StartupRuntimeSummary = {
  kind: 'configuration-only', slug: 'workspace-rox', providerType: 'omp', isDefault: true,
  defaultModel: 'rox/r1-max', models: [{ id: 'rox/r1-max', name: 'Rox R1 Max', supportsThinking: true, contextWindow: 200000 }],
}
const lockedCatalog: SessionModelCatalog = { kind: 'configuration-only', sessionId: 'session-a', workspaceId: 'workspace', slug: 'private-omp', providerType: 'omp',
  defaultModel: 'anthropic/claude-sonnet-4-5', models: [{ id: 'anthropic/claude-sonnet-4-5', name: 'Sonnet' }] }
const requests: Array<{ sessionId: string; resolve: (catalog: SessionModelCatalog | null) => void; reject: () => void }> = []
const api = {
  isChannelAvailable: () => false,
  getToolchainDisabled: async () => [], getDefaultThinkingLevel: async () => 'think',
  getEnvOverrides: async () => ({}), getWorkspaceSettings: async () => ({ permissionMode: 'safe' }),
  getSecretRefs: async () => ({ refs: [], infisical: { available: false } }),
  getAutoCapitalisation: async () => false, getSendMessageKey: async () => 'enter', getSpellCheck: async () => false,
  getHomeDir: async () => { if (query.get('home') === 'denied') throw { code: 'FORBIDDEN', message: 'Request failed' }; return '' },
  getSessionModelCatalog: (sessionId: string) => {
    calls.push({ method: 'catalog', args: sessionId })
    if (query.get('catalog') === 'deferred') return new Promise<SessionModelCatalog | null>((resolve, reject) => { requests.push({ sessionId, resolve, reject: () => reject({ code: 'FORBIDDEN' }) }) })
    if (query.get('catalog') === 'failed') return Promise.reject({ code: 'FORBIDDEN', message: 'Request failed' })
    if (query.get('catalog') === 'removed') return Promise.resolve(null)
    return Promise.resolve(lockedCatalog)
  },
}
window.electronAPI = api as unknown as typeof window.electronAPI
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
function App() {
  const [summary, setSummary] = useState(catalog)
  const scoped = query.has('catalog')
  const [model, setModel] = useState(scoped ? lockedCatalog.defaultModel! : catalog.defaultModel!)
  const [scope, setScope] = useState({ workspaceId: 'workspace', sessionId: 'session-a', connection: 'private-omp' })
  const read = useSessionModelCatalog(scope.workspaceId, scope.sessionId, scope.connection, scoped ? summary : undefined)
  ;(window as any).__catalogFixture = { calls, setSummary, setModel, setScope, requests,
    resolve: (index: number, value: SessionModelCatalog | null) => requests[index]!.resolve(value), reject: (index: number) => requests[index]!.reject() }
  const onModelChange = (model: string, connection?: string) => { calls.push({ method: 'model', args: { model, connection } }); setModel(model) }
  const context = {
    workspaces: [{ id: 'workspace', slug: 'workspace', name: 'Synthetic workspace', rootPath: '' }],
    activeWorkspaceId: scope.workspaceId, activeWorkspaceSlug: 'workspace', llmConnections: [], runtimeSummary: summary,
    sessionModelCatalog: scoped ? read.catalog : undefined,
    workspaceDefaultLlmConnection: summary.slug, refreshLlmConnections: async () => {},
    pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(),
  }
  const foreign = scoped ? scope.connection : query.get('connection') === 'foreign' ? 'removed-connection' : undefined
  const unavailable = scoped ? read.connectionUnavailable : !!foreign
  return <Provider><AppShellProvider value={context as any}><EscapeInterruptProvider><TooltipProvider>
    {query.get('view') === 'runtime' ? <div style={{ height: '100vh' }}><RuntimeSettingsPage /></div>
      : <main className="mx-auto max-w-4xl space-y-12 p-8">
        <output data-testid="catalog-state">{scoped ? read.status : 'default'}</output>
        <section data-testid="desktop-model-picker"><FreeFormInput onSubmit={() => {}} currentModel={model} currentConnection={foreign} connectionUnavailable={unavailable} onModelChange={onModelChange} workspaceId={scope.workspaceId} isEmptySession={!scoped} /></section>
        <section data-testid="compact-model-picker"><CompactModelSelector currentModel={model} currentConnection={foreign} connectionUnavailable={unavailable} onModelChange={onModelChange} isEmptySession={!scoped} /></section>
      </main>}
  </TooltipProvider></EscapeInterruptProvider></AppShellProvider></Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
