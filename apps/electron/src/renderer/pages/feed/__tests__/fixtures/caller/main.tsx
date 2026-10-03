import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import FeedPage from '../../../../FeedPage'
import { Context } from './context'
import { setPersonalTaskScope } from '@/lib/personal-tasks'
import type { PersonalTask, PersonalTaskWrite } from '@craft-agent/core/tasks/personal'
import type { FeedListResult, FeedAnnotationPatch } from '@craft-agent/shared/feed'
import type { ElectronAPI, NoteDocument, NoteMutationOptions } from '../../../../../../shared/types'
import en from '../../../../../../../../../packages/shared/src/i18n/locales/en.json'
import ru from '../../../../../../../../../packages/shared/src/i18n/locales/ru.json'
import '@/index.css'

const mode = new URLSearchParams(location.search).get('mode') ?? 'loaded'
let actor = localStorage.getItem('fixture-actor') ?? 'A'
let identityFailure = false, noteFailure = mode === 'note-retry', taskFailure = mode === 'task-retry'
const listeners = new Set<() => void>()
const pendingLists: Array<{ actor: string; resolve: (value: FeedListResult) => void }> = []
const pendingTasks: Array<() => void> = []
const pendingNotes: Array<() => void> = []
const calls: Array<{ method: string; actor: string; args?: unknown[] }> = []
const record = (method: string, args?: unknown[]) => calls.push({ method, actor, args })
const identity = () => ({ userId: actor, issuer: 'fixture-issuer', authority: mode === 'legacy-note' ? 'local' as const : 'native' as const })
const result = (owner: string, title = `Actor ${owner} private feed`): FeedListResult => ({
  generatedAt: Date.now(), x: { state: 'not-connected' }, refreshAllowed: mode !== 'readonly',
  items: [{ id: 'own-item', tab: 'agents', kind: mode === 'ru-error' ? 'automation-run' : 'session', title,
    summary: 'Full useful article body', url: 'https://example.com/original', at: Date.now(),
    ...(mode === 'ru-error' ? { error: 'automation-run-failed', status: 'error' as const } : {}) }],
  sources: [], annotations: {},
})
const note = (): NoteDocument => ({ id: 'converted-note', nativeId: mode === 'legacy-note' ? undefined : 'native-note-id',
  title: 'Converted', content: '# Converted\n', nativeRevision: mode === 'legacy-note' ? undefined : 4,
  revision: 'opened-content-hash', sourceStoreId: mode === 'legacy-note' ? 'legacy-source-owner' : 'native-journal:workspace-A',
  path: '', relativePath: '', tags: [], properties: {}, links: [], assetRefs: [], backlinks: [], updatedAt: 1, createdAt: 1, size: 12 })
const tasks = new Map<string, PersonalTask>()
window.electronAPI = Object.freeze({
  getOrgIdentity: async () => { if (identityFailure) throw new Error('Fixture identity unavailable'); return identity() },
  getWindowWorkspace: async () => 'workspace-A',
  onIdentityChanged: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback) } },
  feedList: async () => { record('feedList'); const owner = actor; if (mode === 'deferred') return new Promise<FeedListResult>(resolve => pendingLists.push({ actor: owner, resolve })); return result(owner) },
  onFeedChanged: () => () => {},
  feedRefresh: async (id?: string | null) => { record('feedRefresh', [id]); return { ok: true } },
  feedAnnotate: async (ids: string[], patch: FeedAnnotationPatch) => { record('feedAnnotate', [ids, patch]); return { updated: ids.length } },
  createNote: async (...args: Parameters<ElectronAPI['createNote']>) => {
    record('createNote', args)
    if (mode !== 'legacy-note' && args[3]?.recoverCreation !== true) throw new Error('Feed creation recovery opt-in required')
    if (mode === 'note-race') await new Promise<void>(resolve => pendingNotes.push(resolve))
    return note()
  },
  readNote: async () => note(),
  saveNote: async (...args: Parameters<ElectronAPI['saveNote']>) => {
    record('saveNote', args)
    const operation = args[4]
    if (mode === 'legacy-note') { if (args[3] !== 'opened-content-hash' || operation !== 'legacy-source-owner') throw new Error('Legacy revision required') }
    else if (!operation || typeof operation === 'string' || (operation as NoteMutationOptions).expectedRevision !== 4 || (operation as NoteMutationOptions).schemaVersion !== 1) throw new Error('Native authored revision required')
    if (noteFailure) { noteFailure = false; throw new Error('Fixture save was not acknowledged') }
    localStorage.setItem('fixture-note-body', args[2])
    return { ...note(), content: args[2], nativeRevision: 5 }
  },
  personalTasksPut: async (entries: PersonalTaskWrite[]) => {
    record('personalTasksPut', [entries])
    if (mode === 'task-deferred' || mode === 'task-race') await new Promise<void>(resolve => pendingTasks.push(resolve))
    if (taskFailure) { taskFailure = false; throw new Error('Fixture native task storage failed') }
    const accepted = entries.map(entry => { tasks.set(entry.task.id, entry.task); localStorage.setItem('fixture-tasks', JSON.stringify([...tasks.values()])); return { task: entry.task, revision: 1 } })
    return { accepted, conflicts: [], rejected: [], at: Date.now() }
  },
  personalTasksList: async () => ({ tasks: [...tasks.values()], revisions: Object.fromEntries([...tasks.keys()].map(id => [id, 1])), generatedAt: Date.now() }),
  personalTasksDelete: async () => ({ deleted: [], conflicts: [], rejected: [], at: Date.now() }),
  personalTasksMigrate: async () => ({ tasks: [...tasks.values()], revisions: {}, generatedAt: Date.now(), migrated: false }),
  onPersonalTasksChanged: () => () => {},
  openUrl: async () => {},
}) as unknown as typeof window.electronAPI
setPersonalTaskScope({ ...identity(), workspaceId: 'workspace-A' })
const fixture = {
  calls,
  switchActor(next: string) { actor = next; localStorage.setItem('fixture-actor', actor); setPersonalTaskScope({ ...identity(), workspaceId: 'workspace-A' }); for (const listener of [...listeners]) listener() },
  changeActorWithoutEvent(next: string) { actor = next; localStorage.setItem('fixture-actor', actor); setPersonalTaskScope({ ...identity(), workspaceId: 'workspace-A' }) },
  failIdentity() { identityFailure = true; for (const listener of [...listeners]) listener() },
  recoverIdentity() { identityFailure = false; for (const listener of [...listeners]) listener() },
  resolveList(index: number, title?: string) { const pending = pendingLists[index]; pending?.resolve(result(pending.actor, title)) },
  resolveTasks() { for (const resolve of pendingTasks.splice(0)) resolve() },
  resolveNotes() { for (const resolve of pendingNotes.splice(0)) resolve() },
}
;(window as unknown as { __feedFixture: typeof fixture }).__feedFixture = fixture
await i18n.use(initReactI18next).init({ lng: mode === 'ru-error' ? 'ru' : 'en', fallbackLng: 'en', resources: { en: { translation: en }, ru: { translation: ru } }, interpolation: { escapeValue: false } })
const app = <Provider><Context.Provider value={{ activeWorkspaceId: 'workspace-A' }}><div className="h-screen w-full overflow-hidden"><FeedPage selectedId="own-item" /></div></Context.Provider></Provider>
createRoot(document.getElementById('root')!).render(mode === 'strict' ? <React.StrictMode>{app}</React.StrictMode> : app)
