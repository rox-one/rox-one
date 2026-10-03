/**
 * useProjects
 *
 * Loads workspace-scoped projects and keeps them in sync via the
 * `projects:changed` broadcast. Mirrors the lightweight half of `useAutomations`.
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useSetAtom } from 'jotai'
import { projectsAtom } from '@/atoms/projects'
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
  const setProjectsAtom = useSetAtom(projectsAtom)
  // Each committed scope owns its callbacks. Returning to the same workspace
  // creates a new lease, so a request from the first visit cannot revive.
  const scope = useMemo(() => ({
    workspaceId: activeWorkspaceId, active: false, requestId: 0,
  }), [activeWorkspaceId])

  useLayoutEffect(() => {
    scope.active = true
    setProjects([])
    setProjectsAtom([])
    return () => {
      scope.active = false
      scope.requestId++
    }
  }, [scope, setProjectsAtom])

  const refresh = useCallback(async () => {
    if (!scope.active || !scope.workspaceId) return
    const requestId = ++scope.requestId
    try {
      const result = await window.electronAPI.getProjects(scope.workspaceId)
      if (!scope.active || requestId !== scope.requestId) return
      const list = workspaceProjects(result, scope.workspaceId)
      setProjects(list)
      setProjectsAtom(list)
    } catch (err) {
      if (!scope.active || requestId !== scope.requestId) return
      console.error('[useProjects] Failed to load projects:', err)
      setProjects([])
      setProjectsAtom([])
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
