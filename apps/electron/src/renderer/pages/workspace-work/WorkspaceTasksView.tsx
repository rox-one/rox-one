import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTodo, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { WORKSPACE_TASK_STATUSES, type WorkspaceTask, type WorkspaceTaskInput, type WorkspaceTaskLink, type WorkspaceTaskStatus } from '@rox/shared/workspace-work'
import { useWorkspaceWork } from '@/lib/useWorkspaceWork'
import { localDateTimeInput, parseLocalDateTime, workspaceProjectOptions, type WorkspaceProjectOption } from '@/lib/workspace-work-client'

const fieldClass = 'w-full rounded-lg border border-border/70 bg-background px-2.5 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
const buttonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[13px] transition-colors motion-reduce:transition-none hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none'
type TaskDraft = { id: string | null; title: string; description: string; status: WorkspaceTaskStatus; assigneeId: string; projectId: string; due: string; links: WorkspaceTaskLink[]; expectedRevision: number }

export function WorkspaceTasksView({ workspaceId, projectId, selectedTaskId }: { workspaceId: string; projectId?: string; selectedTaskId?: string }) {
  const { t, i18n } = useTranslation()
  const work = useWorkspaceWork(workspaceId)
  const { snapshot } = work
  const [draft, setDraft] = useState<TaskDraft | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorkspaceTaskStatus | 'all'>('all')
  const [projects, setProjects] = useState<WorkspaceProjectOption[]>([])
  const [projectError, setProjectError] = useState(false)
  const [projectReload, setProjectReload] = useState(0)
  const [comment, setComment] = useState('')
  const openedTask = useRef<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  useEffect(() => { openedTask.current = null; setDraft(null); setComment(''); setDeleteTarget(null); setQuery(''); setFilter('all') }, [workspaceId, projectId])
  useEffect(() => {
    if (!selectedTaskId) { openedTask.current = null; return }
    if (!snapshot || openedTask.current === selectedTaskId) return
    const task = snapshot.tasks.find(item => item.id === selectedTaskId && (!projectId || item.project?.id === projectId))
    if (!task) return
    openedTask.current = selectedTaskId
    setDraft({ id: task.id, title: task.title, description: task.description, status: task.status, assigneeId: task.assigneeId ?? '', projectId: task.project?.id ?? '', due: localDateTimeInput(task.dueAt), links: task.links, expectedRevision: snapshot.revision })
    setComment(''); setDeleteTarget(null)
  }, [selectedTaskId, snapshot, projectId])
  useEffect(() => {
    let active = true
    let generation = 0
    const request = ++generation
    setProjects([]); setProjectError(false)
    Promise.resolve().then(() => window.electronAPI.getProjects(workspaceId)).then(list => {
      if (active && generation === request) setProjects(workspaceProjectOptions(list, workspaceId))
    }).catch(() => { if (active && generation === request) setProjectError(true) })
    let off: (() => void) | undefined
    try { off = window.electronAPI.onProjectsChanged((changedWorkspaceId, list) => {
      if (!active || changedWorkspaceId !== workspaceId) return
      generation++
      try { setProjects(workspaceProjectOptions(list, workspaceId)); setProjectError(false) } catch { setProjectError(true) }
    }) } catch { /* The catalog read reports unavailable transport visibly. */ }
    return () => { active = false; off?.() }
  }, [workspaceId, projectReload])

  const canWrite = snapshot?.access.canWrite === true
  const busy = work.pending || !snapshot
  const taskExists = !draft?.id || snapshot?.tasks.some(task => task.id === draft.id)
  const tasks = useMemo(() => snapshot?.tasks.filter(task => (!projectId || task.project?.id === projectId)
    && (filter === 'all' || task.status === filter)
    && `${task.title} ${task.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [], [snapshot, projectId, filter, query])
  const begin = (task?: WorkspaceTask) => {
    if (!snapshot) return
    setComment(''); setDeleteTarget(null)
    setDraft(task ? {
      id: task.id, title: task.title, description: task.description, status: task.status, assigneeId: task.assigneeId ?? '',
      projectId: task.project?.id ?? '', due: localDateTimeInput(task.dueAt), links: task.links, expectedRevision: snapshot.revision,
    } : { id: null, title: '', description: '', status: 'todo', assigneeId: '', projectId: projectId ?? '', due: '', links: [], expectedRevision: snapshot.revision })
  }
  const save = async () => {
    if (!draft || !draft.title.trim()) return
    const input: WorkspaceTaskInput = {
      title: draft.title.trim(), description: draft.description, status: draft.status, assigneeId: draft.assigneeId || null,
      project: draft.projectId ? { workspaceId, id: draft.projectId } : null, dueAt: parseLocalDateTime(draft.due), links: draft.links,
    }
    const ok = await work.write(draft.id ? { kind: 'updateTask', id: draft.id, patch: input } : { kind: 'createTask', input }, draft.expectedRevision)
    if (ok) setDraft(null)
  }
  const members = new Map<string, string>(snapshot?.members.map(member => [member.id, member.name]))
  const comments = draft?.id ? snapshot?.comments.filter(item => item.taskId === draft.id) ?? [] : []
  const time = (at: number) => new Date(at).toLocaleString(i18n.resolvedLanguage ?? i18n.language)

  return <section className="flex h-full min-h-0 flex-col bg-background font-sans text-[13px]" data-testid="workspace-tasks-view">
    <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
      <ListTodo className="size-4 text-accent" aria-hidden /><h2 className="mr-auto text-[15px] font-semibold">{t('navigation.work.tasks.title')}</h2>
      <button type="button" className={buttonClass} disabled={work.loading} onClick={() => { void work.refresh(); setProjectReload(value => value + 1) }} aria-label={t('navigation.work.refresh')}><RefreshCw className="size-3.5" aria-hidden /></button>
      <button type="button" className={buttonClass} disabled={!canWrite || busy} onClick={() => begin()}><Plus className="size-3.5" aria-hidden />{t('navigation.work.tasks.new')}</button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-muted-foreground">{t('navigation.work.tasks.explanation')}</p>
      {work.loading && !snapshot && <p role="status">{t('navigation.work.loading')}</p>}
      {work.error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">{t(`navigation.work.errors.${work.error.code}`)}</div>}
      {snapshot && !canWrite && <p role="status" className="text-muted-foreground">{t('navigation.work.readOnly')}</p>}
      <div className="grid gap-2 sm:grid-cols-2"><input type="search" className={fieldClass} value={query} onChange={event => setQuery(event.target.value)} aria-label={t('navigation.work.tasks.search')} placeholder={t('navigation.work.tasks.search')} /><select className={fieldClass} value={filter} onChange={event => setFilter(event.target.value as WorkspaceTaskStatus | 'all')} aria-label={t('navigation.work.tasks.status')}><option value="all">{t('navigation.work.tasks.all')}</option>{WORKSPACE_TASK_STATUSES.map(status => <option key={status} value={status}>{t(`navigation.work.status.${status}`)}</option>)}</select></div>
      {snapshot && <div className="max-h-80 space-y-1 overflow-y-auto" role="list">
        {tasks.map(task => <div role="listitem" key={task.id}><button type="button" data-testid={`workspace-task-${task.id}`} className={`${buttonClass} w-full justify-start text-left ${draft?.id === task.id ? 'border-accent bg-accent/10' : ''}`} onClick={() => begin(task)}>
          <span className="min-w-0 flex-1"><span className="block break-words font-medium">{task.title}</span><span className="block text-xs text-muted-foreground">{t(`navigation.work.status.${task.status}`)}{task.assigneeId ? ` · ${members.get(task.assigneeId) ?? t('navigation.work.tasks.missingMember')}` : ''}{task.dueAt ? ` · ${time(task.dueAt)}` : ''}</span></span>
        </button></div>)}
        {!tasks.length && <p className="rounded-lg border border-dashed border-border p-4 text-muted-foreground">{t(query || filter !== 'all' ? 'navigation.work.tasks.noMatches' : 'navigation.work.tasks.empty')}</p>}
      </div>}
      {draft && <form className="max-w-3xl space-y-3 rounded-lg border border-border/70 p-4" onSubmit={event => { event.preventDefault(); void save() }}>
        <h3 className="font-semibold">{t(draft.id ? 'navigation.work.tasks.edit' : 'navigation.work.tasks.new')}</h3>
        {!taskExists && <p role="alert" className="text-destructive">{t('navigation.work.tasks.deleted')}</p>}
        <label className="block space-y-1"><span>{t('navigation.work.tasks.name')}</span><input required maxLength={500} className={fieldClass} disabled={!canWrite || busy || !taskExists} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="block space-y-1"><span>{t('navigation.work.tasks.description')}</span><textarea className={`${fieldClass} min-h-24 resize-y`} disabled={!canWrite || busy || !taskExists} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1"><span>{t('navigation.work.tasks.status')}</span><select className={fieldClass} disabled={!canWrite || busy || !taskExists} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as WorkspaceTaskStatus })}>{WORKSPACE_TASK_STATUSES.map(status => <option key={status} value={status}>{t(`navigation.work.status.${status}`)}</option>)}</select></label>
          <label className="block space-y-1"><span>{t('navigation.work.tasks.assignee')}</span><select className={fieldClass} disabled={!canWrite || busy || !taskExists} value={draft.assigneeId} onChange={event => setDraft({ ...draft, assigneeId: event.target.value })}><option value="">{t('navigation.work.tasks.unassigned')}</option>{snapshot?.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}{draft.assigneeId && !members.has(draft.assigneeId) && <option value={draft.assigneeId}>{t('navigation.work.tasks.missingMember')}</option>}</select></label>
          <label className="block space-y-1"><span>{t('navigation.work.tasks.project')}</span><select className={fieldClass} disabled={!canWrite || busy || !taskExists || Boolean(projectId)} value={draft.projectId} onChange={event => setDraft({ ...draft, projectId: event.target.value })}><option value="">{t('navigation.work.tasks.noProject')}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}{draft.projectId && !projects.some(project => project.id === draft.projectId) && <option value={draft.projectId}>{t('navigation.work.tasks.missingProject')}</option>}</select></label>
          <label className="block space-y-1"><span>{t('navigation.work.tasks.deadline')}</span><input type="datetime-local" className={fieldClass} disabled={!canWrite || busy || !taskExists} value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} /></label>
        </div>
        {projectError && <p role="status" className="text-muted-foreground">{t('navigation.work.tasks.projectError')}</p>}
        {snapshot && draft.expectedRevision !== snapshot.revision && <div className="space-y-2 rounded-lg bg-amber-500/10 p-3" role="status"><p>{t('navigation.work.draftChanged')}</p><button type="button" className={buttonClass} onClick={() => setDraft({ ...draft, expectedRevision: snapshot.revision })}>{t('navigation.work.keepDraftRetry')}</button></div>}
        <div className="flex flex-wrap gap-2"><button type="submit" className={`${buttonClass} bg-accent/10 text-accent`} disabled={!canWrite || busy || !taskExists || !draft.title.trim()}>{t(work.pending ? 'navigation.work.saving' : 'navigation.work.save')}</button><button type="button" className={buttonClass} disabled={work.pending} onClick={() => setDraft(null)}>{t('navigation.work.cancel')}</button>{draft.id && <button type="button" className={`${buttonClass} ml-auto text-destructive`} disabled={!snapshot?.access.canDelete || busy || !taskExists} onClick={() => setDeleteTarget(draft.id)}>{t('navigation.work.delete')}</button>}</div>
        {draft.id && deleteTarget === draft.id && <div className="flex flex-wrap items-center gap-2" role="alert"><span>{t('navigation.work.tasks.deleteConfirm')}</span><button type="button" className={buttonClass} disabled={busy} onClick={() => void work.remove({ kind: 'task', id: draft.id! }, draft.expectedRevision).then(ok => { if (ok) { setDraft(null); setDeleteTarget(null) } })}>{t('navigation.work.delete')}</button><button type="button" className={buttonClass} onClick={() => setDeleteTarget(null)}>{t('navigation.work.cancel')}</button></div>}
      </form>}
      {draft?.id && taskExists && <section className="max-w-3xl space-y-3 rounded-lg border border-border/70 p-4" aria-label={t('navigation.work.tasks.comments')}><h3 className="font-medium">{t('navigation.work.tasks.comments')}</h3>{comments.map(item => <article key={item.id}><p className="text-xs text-muted-foreground">{members.get(item.authorId) ?? t('navigation.work.tasks.missingMember')} · {time(item.createdAt)}</p><p className="whitespace-pre-wrap break-words">{item.text}</p></article>)}{!comments.length && <p className="text-muted-foreground">{t('navigation.work.tasks.noComments')}</p>}<form className="space-y-2" onSubmit={event => { event.preventDefault(); if (comment.trim()) void work.write({ kind: 'commentTask', taskId: draft.id!, text: comment.trim() }).then(ok => { if (ok) setComment('') }) }}><textarea className={`${fieldClass} min-h-16 resize-y`} disabled={!canWrite || busy} value={comment} onChange={event => setComment(event.target.value)} aria-label={t('navigation.work.tasks.comment')} /><button type="submit" className={buttonClass} disabled={!canWrite || busy || !comment.trim()}>{t('navigation.work.tasks.addComment')}</button></form></section>}
    </div>
  </section>
}

export default WorkspaceTasksView
