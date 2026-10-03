import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { DeviceStatusChip } from '@/components/app-shell/DeviceStatusChip'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '../../../../../index.css'

await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, keySeparator: false, interpolation: { escapeValue: false } })
const reads: Array<{ kind: string; requestId: string; source?: string }> = []
const cancels: string[] = []
;(window as any).__diagnosticsFixture = { reads, cancels }
;(window as any).electronAPI = {
  getTransportConnectionState: async () => ({ status: 'connected', attempt: 0, mode: 'local', url: 'ws://127.0.0.1:4000/private?token=never-display', lastError: null, lastCloseCode: null }),
  onTransportConnectionStateChanged: () => () => {},
  getServerHealth: async () => ({ status: 'healthy', checks: [] }),
  getServerStatus: async () => ({ running: true, url: 'ws://127.0.0.1:4000/private?token=never-display', needsRestart: false }),
}
;(window as any).deviceDiagnostics = {
  read: async (request: { kind: string; requestId: string; source?: string }) => {
    reads.push(request)
    return { kind: request.kind, sampledAt: Date.now(), platform: 'darwin', result: { status: 'unavailable', reason: 'permission-denied' } }
  },
  cancel: async (requestId: string) => { cancels.push(requestId) },
}
createRoot(document.getElementById('root')!).render(<main className="p-8"><DeviceStatusChip /></main>)
