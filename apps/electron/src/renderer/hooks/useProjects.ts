/**
 * useProjects
 *
 * Loads workspace-scoped projects and keeps them in sync via the
 * `projects:changed` broadcast. Mirrors the lightweight half of `useAutomations`.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { projectsAtom } from '@/atoms/projects'
import { useTourSignals } from '@/features/product-tour/runtime/hooks'
import type { TourCapability } from '@/features/product-tour/contracts'
import type { LoadedProject } from '@rox/shared/projects/types'

export interface UseProjectsResult {
  projects: LoadedProject[]
  refresh: () => Promise<void>
}

function workspaceProjects(value: unknown, workspaceId: string): LoadedProject[] {
  if (!Array.isArray(value)) return []
  return value.filter((project): project is LoadedProject => (
    project !== null && typeof project === 'object' && project.workspaceId === workspaceId
  ))
}

export function useProjects(activeWorkspaceId: string | null | undefined): UseProjectsResult {
  const [projects, setProjects] = useState<LoadedProject[]>([])
  const tour = useTourSignals({ workspaceId: activeWorkspaceId ?? undefined })
  const setProjectsAtom = useSetAtom(projectsAtom)
  // Each committed scope owns its callbacks. Returning to the same workspace
  // creates a new lease, so a request from the first visit cannot revive.
  const scope = useMemo(() => ({
    workspaceId: activeWorkspaceId, active: false, requestId: 0,
  }), [activeWorkspaceId])

  const [readiness, setReadiness] = useState<{ scope: typeof scope; value: TourCapability }>(() => ({ scope, value: { state: 'pending', reason: 'installing' } }))
  useEffect(() => tour.capability('projects.available', readiness.scope === scope
    ? readiness.value : { state: 'pending', reason: 'installing' }), [tour, readiness, scope])

  useLayoutEffect(() => {
    scope.active = true
    setProjects([])
    setProjectsAtom([])
    setReadiness({ scope, value: { state: 'pending', reason: 'installing' } })
    return () => {
      scope.active = false
      scope.requestId++
    }
  }, [scope, setProjectsAtom])

  const refresh = useCallback(async () => {
    if (!scope.active || !scope.workspaceId) return
    const requestId = ++scope.requestId
    setReadiness(previous => previous.scope === scope && previous.value.state === 'ready' ? previous
      : { scope, value: { state: 'pending', reason: 'installing' } })
    try {
      const result = await window.electronAPI.getProjects(scope.workspaceId)
      if (!scope.active || requestId !== scope.requestId) return
      if (!Array.isArray(result)) throw new Error('Invalid Projects list response')
      const list = workspaceProjects(result, scope.workspaceId)
      setProjects(list)
      setProjectsAtom(list)
      setReadiness({ scope, value: { state: 'ready' } })
    } catch (err) {
      if (!scope.active || requestId !== scope.requestId) return
      console.error('[useProjects] Failed to load projects:', err)
      setProjects([])
      setProjectsAtom([])
      setReadiness({ scope, value: { state: 'unavailable', reason: 'api-unavailable' } })
    }
  }, [scope, setProjectsAtom])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!scope.workspaceId) return
    let subscribed = true
    const off = window.electronAPI.onProjectsChanged((wsId: string, list: unknown) => {
      if (!subscribed || !scope.active || wsId !== scope.workspaceId) return
      // A live update is newer than the query already in flight.
      scope.requestId++
      const projects = workspaceProjects(list, scope.workspaceId)
      setProjects(projects)
      setProjectsAtom(projects)
      setReadiness({ scope, value: Array.isArray(list) ? { state: 'ready' } : { state: 'unavailable', reason: 'api-unavailable' } })
    })
    return () => {
      subscribed = false
      if (typeof off === 'function') off()
    }
  }, [scope, setProjectsAtom])

  return {
    projects: activeWorkspaceId ? workspaceProjects(projects, activeWorkspaceId) : [],
    refresh,
  }
}
