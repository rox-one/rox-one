import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { RoxConnectStep } from '@/components/onboarding/RoxConnectStep'
import { useOnboarding } from '../../../useOnboarding'
import AccountSettingsPage from '../../../../pages/settings/AccountSettingsPage'
import { Toaster } from 'sonner'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../packages/shared/src/i18n/locales/ru.json'
import '../../../../index.css'

// Synthetic RPC only. Never opens a browser, reads real credentials, or creates
// a production account. Rendering and onboarding callbacks are production code.
const query = new URLSearchParams(location.search)
const calls: Array<{ method: string; args?: unknown }> = []
let name: string | undefined
let approved = false
let outcome = query.get('outcome') ?? 'ok'
let starts = 0
let profileReads = 0
const profile = { id: 'synthetic-user', displayName: 'Existing Ada', email: 'ada@example.test', plan: 'standard', mode: 'local' }
const pendingStarts: Array<(value: unknown) => void> = []
const record = (method: string, args?: unknown) => { calls.push({ method, args }) }
const codes = (code = 'TEST-CODE') => ({ success: true, userCode: code, verificationUri: 'https://auth.example.test/device', verificationUriComplete: `https://auth.example.test/device?code=${code}`, expiresIn: 60 })
window.electronAPI = {
  checkGitBash: async () => ({ platform: 'linux', found: true }),
  getOrgIdentity: async () => ({ userId: 'synthetic-user', authority: 'native', issuer: 'synthetic-server', name }),
  updateOrgIdentity: async (args: { name?: string }) => { record('updateOrgIdentity', args); if (outcome === 'save-failed') throw new Error('synthetic-write-failure'); name = args.name; return { name } },
  identityGetState: async () => {
    record('identityGetState'); profileReads++
    if (query.get('mode') !== 'account') throw new Error('Host profile access must not happen')
    if (outcome === 'read-failed' && profileReads === 1) throw new Error('synthetic-profile-read-failure')
    return { profile, connections: [], entitlements: [] }
  },
  identityUpdateProfile: async (args: { displayName?: string; email?: string }) => {
    record('identityUpdateProfile', args)
    if (outcome === 'save-failed') throw new Error('synthetic-profile-write-failure')
    Object.assign(profile, args); return { profile: { ...profile }, connections: [], entitlements: [] }
  },
  onIdentityChanged: () => () => {},
  getGamificationProfile: async () => { if (outcome === 'xp-failed') throw new Error('synthetic-xp-unavailable'); return { xp: 10, level: 1, progress: 0.1, xpIntoLevel: 10, xpForNext: 100, nextThreshold: 100, recentEvents: [], balance: null } },
  onGamificationChanged: () => () => {},
  getEnvironmentSetup: async () => ({ prefs: { browserImport: { value: ['history', 'bookmarks', 'cookies', 'credentials'] } } }),
  saveEnvironmentSetup: async () => ({}),
  onEnvironmentChanged: () => () => {},
  startRoxConnect: async () => {
    record('startRoxConnect'); starts++
    if (outcome === 'start-failed' && starts === 1) return { success: false, error: 'synthetic-device-start-failure' }
    if (outcome === 'deferred-start') return new Promise(resolve => pendingStarts.push(resolve))
    return codes()
  },
  getRoxCloudState: async () => { record('getRoxCloudState'); return { connected: approved, required: true, authBaseUrl: 'https://auth.example.test', connectError: null } },
  openUrl: async (url: string) => { record('openUrl', url); if (outcome === 'browser-failed') throw new Error('synthetic-browser-failure') },
} as unknown as typeof window.electronAPI
const fixture = { calls,
  setOutcome(value: string) { outcome = value },
  approve() { approved = true },
  resolveStart(index: number, code: string) { pendingStarts[index]?.(codes(code)) },
  start: () => {},
}
;(window as any).__authFixture = fixture
await i18n.use(initReactI18next).init({ lng: query.get('lang') ?? 'en', fallbackLng: 'en', keySeparator: false, resources: { en: { translation: en }, ru: { translation: ru } }, interpolation: { escapeValue: false } })

function App() {
  const [continued, setContinued] = useState(false)
  const onboarding = useOnboarding({ initialStep: 'rox-connect', onComplete: () => { setContinued(true) } })
  fixture.start = onboarding.handleStartRoxConnect
  if (query.get('mode') === 'account') return <><AccountSettingsPage /><Toaster /></>
  if (query.get('mode') === 'welcome') return <><WelcomeStep onContinue={() => { record('continued'); setContinued(true) }} /><output data-testid="continued">{String(continued)}</output></>
  return <>
    <RoxConnectStep codes={onboarding.roxConnectCodes} status={onboarding.roxConnectStatus} errorMessage={onboarding.roxConnectError} onStart={onboarding.handleStartRoxConnect} onOpenBrowser={onboarding.handleOpenRoxConnectBrowser} authBaseUrl={onboarding.roxAuthBaseUrl} />
    <output data-testid="status">{onboarding.roxConnectStatus}</output><output data-testid="step">{onboarding.state.step}</output>
  </>
}
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-xl p-8"><App /></main>)
