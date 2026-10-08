import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import SecuritySettingsPage from '../../../SecuritySettingsPage'
import { FixtureWorkspace } from './context'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../../packages/shared/src/i18n/locales/ru.json'
import '../../../../../index.css'

// Synthetic transports only; production page, resource loaders and controls.
const query = new URLSearchParams(location.search)
const calls: Array<{ method: string; args?: unknown }> = []
let roxOutcome = query.get('rox') ?? 'ready'
let openclawOutcome = query.get('openclaw') ?? 'missing'
let auditOutcome = query.get('audit') ?? 'none'
let deferred: Array<{ method: string; scope: string; resolve: (result: any) => void }> = []
const subscribers = new Set<(status: any) => void>()
const record = (method: string, args?: unknown) => calls.push({ method, args })
const tool = (phase = roxOutcome) => ({ name: 'omp', phase, installedVersion: phase === 'ready' ? '18.4.12' : undefined })
const runtime = (scope = fixture.workspaceId, state = openclawOutcome) => ({ workspaceId: scope, runtimeId: 'synthetic-openclaw', state: state === 'missing' ? 'unavailable' : state,
  installed: state !== 'missing', provisioned: state !== 'missing', running: state === 'running', safeError: state === 'missing' ? 'RUNTIME_MISSING' : undefined })
const snapshot = (scope: string) => ({ workspaceId: scope, startedAt: 1000, completedAt: 2000, mode: 'standard', runtime: runtime(scope, 'stopped'), findings: [], domains: [],
  summary: { critical: 0, warn: 0, info: 0, pass: 0, accepted: 0, unavailable: 0 }, coverage: { standard: 'complete', deep: 'not-requested' } })
const get = async (method: string, outcome: string, scope: string, result: unknown) => {
  record(method, { workspaceId: scope })
  if (outcome === 'failed') throw new Error('synthetic-unavailable')
  if (outcome === 'deferred') return new Promise(resolve => deferred.push({ method, scope, resolve }))
  return result
}
const api: any = {
  isChannelAvailable(channel: string) {
    if (channel === 'toolchain:status') return roxOutcome !== 'unavailable'
    if (channel === 'toolchain:update') return query.get('local') === 'true'
    if (channel.startsWith('openclawRuntime:')) return openclawOutcome !== 'unavailable'
    if (channel.startsWith('securityAudit:')) return auditOutcome !== 'unavailable'
    return true
  },
  getToolchainStatus: async () => get('roxStatus', roxOutcome, fixture.workspaceId, [tool()]),
  onToolchainStatusChanged: (callback: (status: any) => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } },
  updateToolchainTool: async (name: string) => { record('updateRox', name); if (query.get('update') === 'failed') throw new Error('synthetic-update-failed'); roxOutcome = 'ready'; return tool() },
  openclawRuntime: {
    getStatus: async (args: any) => get('openclawStatus', openclawOutcome, args.workspaceId, runtime(args.workspaceId)),
    install: async (args: any) => { record('installOpenclaw', args); openclawOutcome = 'provisioned'; return runtime(args.workspaceId) },
    provision: async (args: any) => { record('provisionOpenclaw', args); openclawOutcome = 'provisioned'; return runtime(args.workspaceId) },
    start: async (args: any) => { record('startOpenclaw', args); openclawOutcome = 'running'; return runtime(args.workspaceId) },
    stop: async (args: any) => { record('stopOpenclaw', args); openclawOutcome = 'stopped'; return runtime(args.workspaceId) },
  },
  securityAudit: {
    getLatest: async (args: any) => get('auditStatus', auditOutcome, args.workspaceId, auditOutcome === 'ready' ? snapshot(args.workspaceId) : null),
    run: async (args: any) => { record('runAudit', args); return snapshot(args.workspaceId) },
    acceptRisk: async (args: any) => record('acceptRisk', args), revokeRiskAcceptance: async (args: any) => record('revokeRisk', args),
  },
  fabricInfisicalHealth: async () => ({ available: false }),
}
if (query.get('readonly') === 'true') { for (const key of ['install','provision','start','stop']) delete api.openclawRuntime[key]; for (const key of ['run','acceptRisk','revokeRiskAcceptance']) delete api.securityAudit[key] }
window.electronAPI = api
const fixture: {
  calls: typeof calls
  workspaceId: string
  setOutcome(method: string, outcome: string): void
  resolve(method: string, scope?: string, value?: unknown): void
  emitStatus(phase: string): void
  setWorkspace(id: string): void
} = {
  calls, workspaceId: 'workspace-a',
  setOutcome(method: string, outcome: string) { if (method === 'rox') roxOutcome = outcome; if (method === 'openclaw') openclawOutcome = outcome; if (method === 'audit') auditOutcome = outcome },
  resolve(method: string, scope: string = fixture.workspaceId, value?: unknown) {
    const next = deferred.find(item => item.method === method && item.scope === scope)
    if (!next) throw new Error('No deferred request')
    deferred = deferred.filter(item => item !== next)
    next.resolve(value ?? (method === 'roxStatus' ? [tool('ready')] : method === 'openclawStatus' ? runtime(scope, 'running') : snapshot(scope)))
  },
  emitStatus(phase: string) { for (const subscriber of subscribers) subscriber(tool(phase)) },
  setWorkspace: (_id: string) => {},
}
;(window as any).__securityFixture = fixture
window.addEventListener('rox-navigate', (event: Event) => {
  if (event instanceof CustomEvent) record('navigate', event.detail)
})
await i18n.use(initReactI18next).init({ lng: query.get('lang') ?? 'en', fallbackLng: 'en', keySeparator: false,
  resources: { en: { translation: en }, ru: { translation: ru } }, interpolation: { escapeValue: false } })
function App() {
  const [id, setWorkspace] = useState('workspace-a')
  fixture.setWorkspace = (next: string) => { fixture.workspaceId = next; setWorkspace(next) }
  return <FixtureWorkspace.Provider value={{ id, name: id, remoteServer: query.get('remote') === 'true' ? {} : undefined }}><main className="h-screen"><SecuritySettingsPage /></main></FixtureWorkspace.Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
