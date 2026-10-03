import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MeetingActionToTask } from '@/pages/meetings/LocalMeetingDetail'
import { MailReader } from '@/pages/inbox/mail/MailPanels'
import { ItemDetail } from '@/pages/extra-screens/radar/RadarPage'
import { DossierPromiseToTask } from '@/pages/extra-screens/dossier/DossierPage'
import { setPersonalTaskScope } from '@/lib/personal-tasks'
import { emptyLocalMeeting } from '../../../../../main/meetings/local-model'
import type { LocalMeeting, MeetingsLocalApi } from '../../../../../shared/meetings-local'
import type { MailMessage } from '../../../../../shared/mail-local'
import type { MailController } from '@/pages/inbox/mail/useMail'
import type { PersonalTask, PersonalTaskPutResult, PersonalTaskWrite } from '@rox/core/tasks/personal'
import type { DossierEntity } from '@/pages/extra-screens/dossier/dossier-model'
import type { RadarItem } from '@/pages/extra-screens/radar/radar-model'
import en from '../../../../../../../../packages/shared/src/i18n/locales/en.json'
import '@/index.css'
import { getDefaultStore } from 'jotai'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { useConfirmedTaskConversion } from '@/hooks/useConfirmedTaskConversion'

// Production components, conversion hook, bridge and caller-scoped task persistence.
// Only the RPC replies are synthetic; no real user, provider or account is accessed.
const params = new URLSearchParams(location.search), surface = params.get('surface') ?? 'meeting'
let mode = params.get('mode') ?? 'ok', actor = 'alice', workspaceId = 'workspace-A'
let boundWorkspaceId = mode === 'workspace-mismatch' ? 'workspace-B' : workspaceId
const authority = mode === 'legacy' ? 'local' : 'native'
getDefaultStore().set(windowWorkspaceIdAtom, workspaceId)
let held: (() => void) | null = null
const records = new Map<string, Map<string, { task: PersonalTask; revision: number }>>()
const calls: Array<{ method: string; scope?: string; id?: string; value?: unknown }> = []
const listeners = new Set<() => void>()
let meeting: LocalMeeting = { ...emptyLocalMeeting({ id: 'meeting-source', title: 'Synthetic planning', workspaceId, now: 1 }), actions: [{ id: 'action-source', text: 'Prepare release notes', done: false, createdAt: 1 }] }
let renderedMeeting = meeting
const mail: MailMessage = { id: 'mail-source', threadId: 'thread-source', folderIds: ['inbox'], from: [{ name: 'Ada', email: 'synthetic@example.test' }], to: [], cc: [], bcc: [], replyTo: [], subject: 'Prepare release notes', preview: 'Synthetic mail source', receivedAt: 1, sentAt: 1, seen: true, flagged: false, draft: false, hasAttachment: false, attachments: [], text: 'Synthetic mail source', html: null, messageId: ['synthetic-message@example.test'], inReplyTo: [], references: [], size: 100 }
const radar: RadarItem = { id: 'radar-source', title: 'Prepare release notes', summary: 'Synthetic radar source', source: 'Synthetic feed', bucket: 'reaction', origin: 'agent' }
const entity: DossierEntity = { id: 'entity-source', name: 'Ada', kind: 'person', aliases: [], notes: '', promises: [{ id: 'promise-source', text: 'Prepare release notes', direction: 'mine', done: false, createdAt: 1 }], createdAt: 1, updatedAt: 1 }
const scope = () => `${actor}:${boundWorkspaceId}`
const store = (key = scope()) => { let result = records.get(key); if (!result) { result = new Map(); records.set(key, result) }; return result }
const write = (writes: PersonalTaskWrite[], key: string): PersonalTaskPutResult => {
  const result: PersonalTaskPutResult = { accepted: [], conflicts: [], rejected: [] }
  for (const item of writes) {
    const previous = store(key).get(item.task.id)
    if ((previous?.revision ?? null) !== item.expectedRevision) { result.conflicts.push({ id: item.task.id, current: previous ?? null }); continue }
    const next = { task: structuredClone(item.task), revision: (previous?.revision ?? 0) + 1 }
    store(key).set(item.task.id, next); result.accepted.push(next)
  }
  return result
}
const meetingsApi = {
  recover: async () => [],
  get: async () => meeting,
  saveAction: async (_id: string, input: { actionId: string; patch?: { taskId?: string } }) => {
    calls.push({ method: 'saveAction', value: input })
    if (mode === 'link-denied') return { ok: false, code: 'unavailable' }
    meeting = { ...meeting, actions: meeting.actions.map(action => action.id === input.actionId ? { ...action, ...input.patch } : action) }
    if (mode === 'link-lost-ack') { mode = 'ok'; throw new Error('Synthetic lost meeting link ACK') }
    return { ok: true, value: meeting }
  },
} as unknown as MeetingsLocalApi
window.electronAPI = {
  meetingsLocal: meetingsApi,
  getOrgIdentity: async () => mode === 'invalid-identity' ? {} : ({ authority, issuer: authority === 'native' ? 'synthetic-authority' : undefined, userId: actor }),
  getWindowWorkspace: async () => boundWorkspaceId,
  onIdentityChanged: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  personalTasksList: async () => ({ tasks: [...store().values()].map(record => record.task), revisions: Object.fromEntries([...store().values()].map(record => [record.task.id, record.revision])), meta: null, migration: null }),
  personalTasksPut: async (writes: PersonalTaskWrite[]) => {
    const key = scope(); calls.push({ method: 'put', scope: key, id: writes[0]?.task.id, value: writes })
    if (mode === 'denied') return { accepted: [], conflicts: [], rejected: writes.map(write => write.task.id) }
    if (mode === 'held') return new Promise<PersonalTaskPutResult>(resolve => { held = () => { resolve(write(writes, key)) } })
    const result = write(writes, key)
    if (mode === 'lost-ack') { mode = 'ok'; throw new Error('Synthetic lost task ACK after commit') }
    return result
  },
  personalTasksDelete: async () => ({ removed: [], conflicts: [], rejected: [] }),
  personalTasksMigrate: async () => ({ tasks: [], revisions: {}, meta: null, migration: null, status: 'migrated', imported: 0, skipped: 0 }),
} as unknown as typeof window.electronAPI
const bind = () => setPersonalTaskScope({ authority, issuer: authority === 'native' ? 'synthetic-authority' : undefined, userId: actor, workspaceId: boundWorkspaceId })
if (mode !== 'no-scope') bind()
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
let rerender: (() => void) | undefined, hide = false
let hookSource = { id: 'hook-source' }, currentConvert: (() => Promise<PersonalTask | null>) | undefined, oldConvert: (() => Promise<PersonalTask | null>) | undefined
;(window as unknown as { __conversion: unknown }).__conversion = {
  calls, read: () => ({ records: [...records].map(([key, records]) => ({ scope: key, tasks: [...records.values()] })), meeting, renderedMeeting }),
  allow: () => { mode = 'ok'; if (params.get('mode') === 'no-scope') bind() },
  retain: () => { oldConvert = currentConvert }, invokeOld: () => oldConvert?.(), invoke: () => currentConvert?.(),
  release: () => { held?.(); held = null },
  unmount: () => { hide = true; rerender?.() },
  change: (kind: string) => {
    if (kind === 'actor') actor = actor === 'alice' ? 'bob' : 'alice'
    if (kind === 'workspace') { workspaceId = workspaceId === 'workspace-A' ? 'workspace-B' : 'workspace-A'; boundWorkspaceId = workspaceId }
    getDefaultStore().set(windowWorkspaceIdAtom, workspaceId)
    if (kind === 'edit') { meeting = { ...meeting, actions: meeting.actions.map(action => ({ ...action, text: 'Edited action source' })) }; renderedMeeting = meeting }
    if (kind === 'replace') { meeting = { ...meeting, actions: meeting.actions.map(action => ({ ...action })) }; renderedMeeting = meeting; hookSource = { ...hookSource } }
    if (kind === 'actor' || kind === 'workspace') {
      bind(); listeners.forEach(listener => listener())
    }
    rerender?.()
  },
}
const controller = { status: { address: 'synthetic@example.test', state: 'ready' }, folders: [], getThread: async () => [mail] } as unknown as MailController
function HookHarness() {
  const conversion = useConfirmedTaskConversion({ sourceKey: 'hook-source', source: hookSource, workspaceId, input: { title: 'Synthetic hook task' } })
  currentConvert = conversion.convert
  return <><button disabled={conversion.busy} onClick={() => { void conversion.convert() }}>To task</button>{conversion.taskId ? <span>Task created</span> : null}{conversion.failed ? <span role="alert">Failed to create the task</span> : null}</>
}
function App() {
  const [, tick] = useState(0)
  rerender = () => flushSync(() => tick(value => value + 1))
  return <main><output data-testid="fixture-ready">{surface}</output>{!hide ? <section data-testid="converter">
    {surface === 'meeting' ? renderedMeeting.actions[0]!.taskId ? <span data-testid="conversion-success">Open task</span> : <MeetingActionToTask action={renderedMeeting.actions[0]!} meeting={renderedMeeting} workspaceId={workspaceId} onChanged={next => { renderedMeeting = next; rerender?.() }} /> : null}
    {surface === 'mail' ? <MailReader mail={controller} message={mail} onCompose={() => {}} /> : null}
    {surface === 'radar' ? <ItemDetail item={radar} workspaceId={workspaceId} language="en" onDismiss={() => {}} /> : null}
    {surface === 'dossier' ? <DossierPromiseToTask entity={entity} promise={entity.promises[0]!} workspaceId={workspaceId} /> : null}
    {surface === 'hook' ? <HookHarness /> : null}
  </section> : null}</main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
