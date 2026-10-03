import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Toaster } from 'sonner'
import { useSessionMenuActions } from '../../../useSessionMenuActions'
import type { SessionCommand } from '@craft-agent/shared/protocol'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../packages/shared/src/i18n/locales/ru.json'

await i18n.use(initReactI18next).init({ lng: 'ru', fallbackLng: 'en', keySeparator: false,
  resources: { en: { translation: en }, ru: { translation: ru } }, interpolation: { escapeValue: false } })

// Only the RPC transport is synthetic: the hook, i18n resources and visible toast are production code.
const calls: Array<{ sessionId: string; type: SessionCommand['type'] }> = []
let pending = false
let release: (() => void) | undefined
Object.assign(window, { electronAPI: { sessionCommand: async (sessionId: string, command: SessionCommand) => {
  calls.push({ sessionId, type: command.type })
  if (pending) return { success: false, errorCode: 'SHARE_BUSY', error: 'Share operation already in progress' }
  pending = true
  return new Promise(resolve => { release = () => { pending = false; resolve({ success: true }) } })
} }, __sharingFixture: { calls, release: () => release?.(), busyText: ru['sessionSharing.error.busy'] } })

function Fixture() {
  const actions = useSessionMenuActions({ item: { id: 'synthetic-session', workspaceId: 'synthetic-workspace', labels: [] } })
  return <>
    <p data-testid="ready">Synthetic Russian concurrent sharing fixture</p>
    <button onClick={() => { void actions.updateShare() }}>Hold first update</button>
    <button onClick={() => { void actions.updateShare() }}>Concurrent update</button>
    <button onClick={() => { void actions.revokeShare() }}>Concurrent revoke</button>
    <button onClick={() => { void actions.share() }}>Concurrent share</button>
    <Toaster duration={30000} />
  </>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
