import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, Provider } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import InboxPage from '../../../../InboxPage'
import { Context } from './context'
import { sessionMetaMapAtom, windowWorkspaceIdAtom } from './sessions'
import type { MailLocalApi, MailSummary, MailStatus } from '../../../../../../shared/mail-local'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'

// Production page, source aggregation and mail hooks. Only source RPCs, shell
// identity and session metadata are synthetic; no personal mailbox is read.
const mode = new URLSearchParams(location.search).get('mode') ?? 'populated'
let actor = 'A'
let issuer = 'fixture-server-one'
const identityListeners = new Set<() => void>()
const pendingApprovals: Array<{ resolve: (value?: unknown) => void; reject: (error: Error) => void }> = []
const calls: Array<{ method: string; value?: unknown }> = []
const store = createStore()
let allowRetry = false
let failMemory = mode === 'source-failed'
let failMail = mode === 'mail-failed'
const hasItems = mode === 'populated' || mode === 'partial-bulk'
const memory = () => mode.startsWith('identity-') ? [{ id: 'shared-id', text: `Actor ${actor} incoming proposal`, status: 'pending', sessionId: 'session-1', createdAt: '2026-10-03T08:00:00Z' }] : mode === 'populated' && !localStorage.getItem('synthetic-memory-approved') || mode === 'source-failed' && allowRetry ? [{ id: 'proposal-1', text: 'Prefer concise release notes', status: 'pending', sessionId: 'session-1', createdAt: '2026-10-03T08:00:00Z' }] : []
const seen: string[] = JSON.parse(localStorage.getItem('synthetic-seen') ?? '[]')
const initialSessions = new Map(hasItems ? ['session-1', 'session-2'].map((id, index) => [id, { id, workspaceId: 'workspace-A', name: index ? 'Review complete' : 'Release reply', hasUnread: !seen.includes(id), lastFinalMessageId: `${id}-reply`, lastMessageAt: Date.now() - index * 1000, lastMessageRole: 'assistant' as const }]) : [])
store.set(sessionMetaMapAtom, initialSessions)
const pendingMemory: Array<{ workspaceId: string; resolve: (value: unknown[]) => void; reject: (error: Error) => void }> = []
const pendingMailStatus: Array<(value: MailStatus) => void> = []
const record = (method: string, value?: unknown) => calls.push({ method, value })
const mailStatus: MailStatus = { flag: 'inbox.mail.v1', enabled: mode === 'populated' || mode === 'mail-unreachable', state: mode === 'populated' ? 'ready' : mode === 'mail-unreachable' ? 'unreachable' : 'disabled', serverUrl: 'https://mail.example.test', domain: 'example.test', local: false, reachable: mode !== 'mail-unreachable', address: 'ada@example.test', push: 'off' }
if (mode === 'optional-mail-setup' || mode === 'explicit-local-mail') Object.assign(mailStatus, { enabled: true, state: 'unreachable', configured: mode === 'explicit-local-mail', serverUrl: 'http://127.0.0.1:8480', domain: 'rox.one', local: true, reachable: false, address: null })
const mailItem: MailSummary = { id: 'email-1', threadId: 'thread-1', folderIds: ['inbox'], from: [{ name: 'Design team', email: 'team@example.test' }], to: [{ name: 'Ada', email: 'ada@example.test' }], subject: 'Design feedback', preview: 'Please review the prototype', receivedAt: Date.now(), seen: false, flagged: false, draft: false, hasAttachment: false, size: 80 }
const mailApi = {
  status: async () => { record('mail.status'); if (mode === 'mail-race' || mode === 'identity-mail-race') return new Promise<MailStatus>((resolve) => pendingMailStatus.push(resolve)); if (failMail) throw new Error('Synthetic mailbox unreachable'); return mailStatus },
  folders: async () => ({ ok: true, value: [{ id: 'inbox', name: 'Inbox', role: 'inbox', unread: 1, total: 1 }] }),
  list: async () => ({ ok: true, value: { items: mode === 'populated' && !mailItem.seen ? [mailItem] : [], total: mailItem.seen ? 0 : 1 } }),
  get: async () => ({ ok: true, value: { ...mailItem, cc: [], bcc: [], replyTo: [], sentAt: null, messageId: [], inReplyTo: [], references: [], text: 'Please review the prototype', html: null, attachments: [] } }),
  getThread: async () => ({ ok: true, value: [{ ...mailItem, cc: [], bcc: [], replyTo: [], sentAt: null, messageId: [], inReplyTo: [], references: [], text: 'Please review the prototype', html: null, attachments: [] }] }),
  setFlags: async (ids: string[], flags: { seen?: boolean }) => { record('mail.setFlags', { ids, flags }); mailItem.seen = flags.seen ?? mailItem.seen; return { ok: true, value: ids.length } },
  onChanged: () => () => {},
} as unknown as MailLocalApi
window.electronAPI = {
  mailLocal: mailApi,
  listMemoryProposals: async (workspaceId: string) => { record('listMemoryProposals', workspaceId); if (mode === 'workspace-triage') return workspaceId === 'workspace-A' ? [{ id: 'proposal-A', text: 'Snooze this workspace A proposal', status: 'pending', sessionId: 'session-A', createdAt: '2026-10-03T08:00:00Z' }] : []; if (mode === 'deferred' || mode === 'workspace-race' || mode === 'refresh-race' || mode === 'identity-source-race') return new Promise<unknown[]>((resolve, reject) => pendingMemory.push({ workspaceId, resolve, reject })); if (failMemory && !allowRetry) throw new Error('Synthetic memory source failed'); return memory() },
  listPendingSkills: async () => { record('listPendingSkills'); return mode === 'populated' ? [{ slug: 'release-writer', description: 'New release writing skill', createdAt: Date.now() }] : [] },
  getMessagingPendingSenders: async () => { record('getMessagingPendingSenders'); return mode === 'populated' ? [{ platform: 'telegram', userId: 'sender-1', displayName: 'Design team', lastAttemptAt: Date.now(), attemptCount: 1 }] : [] },
  approveMemoryProposal: async (workspaceId: string, id: string, scope: string) => { record('approveMemoryProposal', { workspaceId, id, scope }); if (mode === 'identity-actions') return new Promise((resolve, reject) => pendingApprovals.push({ resolve, reject })); localStorage.setItem('synthetic-memory-approved', 'true') },
  sessionCommand: async (id: string, command: unknown) => { record('sessionCommand', { id, command }); if (mode === 'partial-bulk' && id === 'session-2' && !allowRetry) throw new Error('Synthetic read receipt failed'); seen.push(id); localStorage.setItem('synthetic-seen', JSON.stringify(seen)); const current = store.get(sessionMetaMapAtom); const next = new Map(current); const item = next.get(id); if (item) next.set(id, { ...item, hasUnread: false }); store.set(sessionMetaMapAtom, next) },
  onMessagingPendingChanged: () => () => {}, onSkillsPendingChanged: () => () => {},
} as unknown as typeof window.electronAPI
if (mode.startsWith('identity-')) Object.assign(window.electronAPI, { identityGetState: async () => ({ annotationActorId: actor, profile: { id: `profile-${actor}` } }), getOrgIdentity: async () => ({ authority: 'native', issuer, userId: actor }), onIdentityChanged: (callback: () => void) => { identityListeners.add(callback); return () => identityListeners.delete(callback) } })
const fixture: { calls: typeof calls; retry: () => void; failMemory: () => void; resolveMemory: (index: number, title: string) => void; resolveMailStatus: (index: number, address: string) => void; switchWorkspace?: (id: string) => void; changeActor: (value: string) => void; changeIssuer: (value: string) => void; identitySubscriptions: () => number; resolveApproval: (index: number, error?: string) => void } = {
  calls, retry: () => { allowRetry = true; failMemory = false; failMail = false }, failMemory: () => { failMemory = true; allowRetry = false },
  resolveMemory: (index, title) => pendingMemory[index]?.resolve(title ? [{ id: `proposal-${index}`, text: title, status: 'pending', sessionId: 'session-1', createdAt: '2026-10-03T08:00:00Z' }] : []),
  resolveMailStatus: (index, address) => pendingMailStatus[index]?.({ ...mailStatus, enabled: true, state: 'ready', address }),
  changeActor: (value) => { actor = value; for (const listener of identityListeners) listener() },
  changeIssuer: (value) => { issuer = value; for (const listener of identityListeners) listener() },
  identitySubscriptions: () => identityListeners.size,
  resolveApproval: (index, error) => error ? pendingApprovals[index]?.reject(new Error(error)) : pendingApprovals[index]?.resolve(),
}
;(window as unknown as { __inboxFixture: unknown }).__inboxFixture = fixture
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
function App() {
  const [workspace, setWorkspace] = useState('workspace-A')
  fixture.switchWorkspace = setWorkspace
  store.set(windowWorkspaceIdAtom, workspace)
  return <Provider store={store}><Context.Provider value={{ activeWorkspaceId: workspace, pendingPermissions: new Map(), pendingCredentials: new Map(), onRespondToPermission: async () => {} }}><div className="h-screen w-full overflow-hidden"><InboxPage /></div></Context.Provider></Provider>
}
createRoot(document.getElementById('root')!).render(mode === 'identity-strict' ? <React.StrictMode><App /></React.StrictMode> : <App />)
