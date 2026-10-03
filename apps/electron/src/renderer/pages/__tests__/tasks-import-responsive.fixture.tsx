import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Provider } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import TasksPage from '../TasksPage'
import { ShellSidebarContext } from '../../components/app-shell/ShellSidebarPortal'
import { PersonalTaskStore, type PersonalTasksSnapshot, type PersonalTaskPutResult, type PersonalTaskWrite, type PersonalTaskMeta } from '@rox/core/tasks/personal'
import { hydratePersonalTasks, loadPersonalTaskStore, persistPersonalTaskStore, setPersonalTaskScope } from '../../lib/personal-tasks'
import en from '@rox/shared/i18n/locales/en.json'
const toasts: Array<[string, string]> = [], calls: string[] = [], navigations: unknown[] = []
let releaseFile: (() => void) | null = null, releasePut: (() => void) | null = null
const watchers = new Set<() => void>()
const records = new Map<string, PersonalTasksSnapshot>()
const empty = (): PersonalTasksSnapshot => ({ tasks: [], revisions: {}, meta: null, migration: null })
const initial = new PersonalTaskStore(); initial.create({ id: 'existing', title: 'Existing task' })
records.set('alice:ws-a', { ...empty(), tasks: initial.list(), revisions: { existing: 1 } })
const ui = {
  toasts, calls, navigations, actor: 'alice', workspace: 'ws-a', externalSidebar: false, holdFile: false, holdPut: false, denyPut: false, denyReadback: false, written: false,
  releaseFile: () => releaseFile?.(), releasePut: () => releasePut?.(), width: (width: number) => { document.getElementById('panel')!.style.width = `${width}px` },
  async scope(actor: string, workspace: string) { ui.actor=actor;ui.workspace=workspace;bind();await hydratePersonalTasks();render() },
  sidebar() { ui.externalSidebar=true; render() },
  edit(title: string) { const store = loadPersonalTaskStore(); store.update('existing', { title }); persistPersonalTaskStore(store) },
  unmount: () => flushSync(() => root.render(null)),
  rows: () => loadPersonalTaskStore().list(),
}
;(window as any).tasksFixture = ui
const key = () => `${ui.actor}:${ui.workspace}`
window.electronAPI = {
  async personalTasksList() { calls.push(`list:${key()}`); if(ui.denyReadback&&ui.written)throw new Error('Synthetic readback denied');return structuredClone(records.get(key())??empty()) },
  async personalTasksPut(writes: PersonalTaskWrite[], meta?: PersonalTaskMeta | null) {
    const owner=key();calls.push(`put:${owner}`);if(ui.denyPut)throw new Error('Synthetic native commit denied')
    const snapshot=records.get(owner)??empty(), result: PersonalTaskPutResult={accepted:[],conflicts:[],rejected:[]}
    for(const write of writes){const revision=snapshot.revisions[write.task.id];if((revision??null)!==write.expectedRevision){result.conflicts.push({id:write.task.id,current:revision?{task:snapshot.tasks.find(row=>row.id===write.task.id)!,revision}:null});continue}
      const record={task:structuredClone(write.task),revision:(revision??0)+1};snapshot.tasks=[...snapshot.tasks.filter(row=>row.id!==write.task.id),record.task];snapshot.revisions[write.task.id]=record.revision;result.accepted.push(record)}
    if(meta)snapshot.meta=structuredClone(meta);records.set(owner,snapshot);ui.written=true;for(const callback of watchers)callback()
    if(ui.holdPut)await new Promise<void>(resolve=>{releasePut=resolve});return structuredClone(result)
  },
  async personalTasksDelete() { throw new Error('Merge import must not delete a task') },
  async personalTasksMigrate() { throw new Error('Native source must not migrate a desktop cache') },
  onPersonalTasksChanged(callback: () => void) { watchers.add(callback);return()=>watchers.delete(callback) },
} as unknown as typeof window.electronAPI
const nativeFileText = File.prototype.text
File.prototype.text = async function() { if(ui.holdFile)await new Promise<void>(resolve=>{releaseFile=resolve});return nativeFileText.call(this) }
const bind=()=>setPersonalTaskScope({ authority:'native', userId:ui.actor, issuer:'fixture-authority',workspaceId:ui.workspace })
localStorage.setItem('rox.tasks.view.v1',JSON.stringify({kind:'list',id:'inbox'}))
const root=createRoot(document.getElementById('root')!)
const render=()=>flushSync(()=>root.render(<Provider><ShellSidebarContext.Provider value={ui.externalSidebar ? document.getElementById('sidebar') : null}><TasksPage /></ShellSidebarContext.Provider></Provider>))
void(async()=>{await i18n.use(initReactI18next).init({lng:'en',fallbackLng:'en',resources:{en:{translation:en}},keySeparator:false,interpolation:{escapeValue:false}});bind();await hydratePersonalTasks();render()})()
