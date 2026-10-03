import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import BrowserProfileImportPanel from '../../../BrowserProfileImportPanel'
import { FixtureWorkspace } from './context'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../../packages/shared/src/i18n/locales/ru.json'
import '../../../../../index.css'

// All transport data is synthetic. This fixture never invokes a native host,
// scans profiles, or reads browser/key-store files.
const query = new URLSearchParams(location.search)
const calls: { method: string; args?: unknown }[] = []
let categories = query.get('categories')?.split(',') ?? ['history', 'bookmarks', 'cookies', 'credentials']
let outcome = query.get('outcome') ?? 'granted'
let importResolver: ((value: unknown) => void) | undefined
let deferredDataAction: string | undefined
let dataResolver: ((value: unknown) => void) | undefined
let deferredMutation: string | undefined
let mutationResolver: ((value: unknown) => void) | undefined
const capabilityResolvers: Record<string, (value: unknown) => void> = {}
const profiles = ['chromium', 'firefox', 'safari'].map((family) => ({
  id: `${family}:synthetic`, family, name: `Synthetic ${family}`,
  path: `/synthetic/${family}`, state: 'ok', recommended: family === 'chromium', lastUsedAt: null,
}))
const record = (method: string, args?: unknown) => { calls.push({ method, args }) }
const summary = (args: any) => ({
  dryRun: args.dryRun, profileId: args.profileId,
  counts: { history: args.consent.history ? 7 : 0, bookmarks: args.consent.bookmarks ? 3 : 0, cookies: 0, credentials: outcome === 'granted' ? 2 : 0, skipped: 0 },
  accessedStores: outcome === 'granted' ? ['credentials'] : [],
  rollbackToken: !args.dryRun && outcome === 'granted' ? 'synthetic-rollback' : null,
  deletionReceipt: null, credentialAccess: outcome,
})
const api = {
  getEnvironmentSetup: async () => { record('getEnvironmentSetup'); return { prefs: { browserImport: { value: categories } } } },
  onEnvironmentChanged: () => () => {},
  saveEnvironmentSetup: async (args: any) => { record('saveEnvironmentSetup', args); categories = args.browserImport.value; return { prefs: { browserImport: { value: categories } } } },
  browserCookieAutoStatus: async () => ({ supported: true, consent: false, state: 'off', imported: 0 }),
  browserDataAutoImport: async (args: any) => {
    record('browserDataAutoImport', args)
    if (args.action === deferredDataAction) return new Promise((resolve) => { dataResolver = resolve })
    return { workspaceId: args.workspaceId, enabled: false, profileId: null, state: 'off', imported: { history: 0, bookmarks: 0 }, lastRunAt: null }
  },
  discoverBrowserProfiles: async (args: any) => { record('discoverBrowserProfiles', args); return profiles },
  browserCredentialCapabilities: async (args: any) => {
    record('browserCredentialCapabilities', args)
    if (query.get('capability') === 'deferred') return new Promise((resolve) => { capabilityResolvers[`${args.workspaceId}:${args.profileId}`] = resolve })
    const supported = args.profileId.startsWith('chromium:') && query.get('capability') !== 'absent'
    return { supported, mechanism: supported ? 'linux-secret-service' : null, reason: supported ? undefined : 'synthetic-unavailable' }
  },
  importBrowserProfile: async (args: any) => {
    record('importBrowserProfile', args)
    if (outcome === 'throw') throw new Error('browser-credentials-synthetic-failure')
    if (outcome === 'deferred') return new Promise((resolve) => { importResolver = resolve })
    return summary(args)
  },
  rollbackBrowserProfileImport: async (args: any) => {
    record('rollbackBrowserProfileImport', args)
    if (deferredMutation === 'rollback') return new Promise((resolve) => { mutationResolver = resolve })
    return { ok: true }
  },
  deleteImportedBrowserProfile: async (workspaceId: string) => {
    record('deleteImportedBrowserProfile', { workspaceId })
    if (deferredMutation === 'delete') return new Promise((resolve) => { mutationResolver = resolve })
    return { deletionReceipt: null }
  },
}
window.electronAPI = api as unknown as typeof window.electronAPI
const fixture = {
  calls,
  setOutcome(value: string) { outcome = value },
  resolveImport(value: unknown) { importResolver?.(value) },
  deferData(action: string) { deferredDataAction = action },
  resolveData(value: unknown) { deferredDataAction = undefined; dataResolver?.(value) },
  deferMutation(action: string) { deferredMutation = action },
  resolveMutation(value: unknown) { deferredMutation = undefined; mutationResolver?.(value) },
  resolveCapability(workspaceId: string, profileId: string, value: unknown) { capabilityResolvers[`${workspaceId}:${profileId}`]?.(value) },
  setWorkspace: (_id: string) => {},
}
;(window as any).__credentialFixture = fixture

await i18n.use(initReactI18next).init({ lng: query.get('lang') ?? 'en', fallbackLng: 'en', resources: { en: { translation: en }, ru: { translation: ru } }, keySeparator: false, interpolation: { escapeValue: false } })

function App() {
  const [id, setWorkspace] = useState('workspace-a')
  fixture.setWorkspace = setWorkspace
  return <FixtureWorkspace.Provider value={{ id }}><main className="mx-auto max-w-3xl p-6"><BrowserProfileImportPanel /></main></FixtureWorkspace.Provider>
}
createRoot(document.getElementById('root')!).render(<App />)
