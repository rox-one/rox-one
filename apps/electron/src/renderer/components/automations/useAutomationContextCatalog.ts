import * as React from 'react'
import { getWorkspaceWorkClient, workspaceProjectOptions } from '@/lib/workspace-work-client'
import type { AutomationContextObjectChoice } from './ContextBindingEditor'

/** Reads canonical catalogs; a missing provider is reported and offers no invented choices. */
export function useAutomationContextCatalog(workspaceId: string | null | undefined) {
  const [catalog, setCatalog] = React.useState<{ workspaceId: string; projects: { id: string; name: string }[]; objects: AutomationContextObjectChoice[]; unavailable: boolean } | null>(null)
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    if (!workspaceId) return
    let active = true
    let generation = 0
    const read = async () => {
      const request = ++generation
      const results = await Promise.allSettled([
        Promise.resolve().then(() => window.electronAPI.getProjects(workspaceId)),
        Promise.resolve().then(() => window.electronAPI.getPages(workspaceId)),
        Promise.resolve().then(() => window.electronAPI.getSessions()),
        Promise.resolve().then(() => getWorkspaceWorkClient(workspaceId).read()),
      ])
      if (!active || request !== generation) return
      const [projectResult, pageResult, sessionResult, taskResult] = results
      let projects: { id: string; name: string }[] = []
      const objects: AutomationContextObjectChoice[] = []
      let unavailable = results.some(result => result.status === 'rejected')
      if (projectResult.status === 'fulfilled') {
        try { projects = workspaceProjectOptions(projectResult.value, workspaceId) } catch { unavailable = true }
      }
      if (pageResult.status === 'fulfilled') for (const page of pageResult.value) {
        if (page.workspaceId === workspaceId) objects.push({ reference: { kind: 'page', id: page.config.id }, name: page.config.name, projectId: page.config.projectId })
      }
      if (sessionResult.status === 'fulfilled') for (const session of sessionResult.value) {
        if (session.workspaceId === workspaceId) objects.push({ reference: { kind: 'session', id: session.id }, name: session.name || session.id, projectId: session.projectId })
      }
      if (taskResult.status === 'fulfilled') for (const task of taskResult.value.tasks) {
        if (task.workspaceId === workspaceId) objects.push({ reference: { kind: 'task', id: task.id }, name: task.title, projectId: task.project?.id })
      }
      setCatalog({ workspaceId, projects, objects, unavailable })
    }
    void read()
    const off: Array<() => void> = []
    for (const subscribe of [
      () => window.electronAPI.onProjectsChanged(id => { if (id === workspaceId) void read() }),
      () => window.electronAPI.onPagesChanged(id => { if (id === workspaceId) void read() }),
      () => getWorkspaceWorkClient(workspaceId).subscribe(() => { void read() }),
    ]) {
      try { off.push(subscribe()) } catch { /* Catalog reads show unavailable transports. */ }
    }
    return () => { active = false; generation++; for (const unsubscribe of off) unsubscribe() }
  }, [workspaceId, reload])
  return { catalog: catalog?.workspaceId === workspaceId ? catalog : null, refresh: () => setReload(value => value + 1) }
}
