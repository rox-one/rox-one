/**
 * Search-first skills catalog hook (ADR-0023 §7, #1866).
 * Holds at most one window of summaries and patches it from `skills:changed`.
 */
import * as React from 'react'
import type { LoadedSkill } from '../../shared/types'
import {
  applySkillsChangedDelta,
  capSkillsLimit,
  emptySkillsQueryPage,
  readSkillsPage,
  shouldRefetchSkillsPage,
  SKILLS_UI_ACCUMULATE_CAP,
  SKILLS_UI_PAGE_SIZE,
  SKILLS_UI_QUERY_DEBOUNCE_MS,
  type SkillsChangedDelta,
  type SkillsQueryPage,
} from '@/lib/skills-query'

export interface UseSkillsQueryArgs {
  workspaceId?: string | null
  workingDirectory?: string
  query?: string
  limit?: number
  enabled?: boolean
  sources?: Array<'omp' | 'global' | 'workspace' | 'project'>
}

export interface UseSkillsQueryResult {
  items: LoadedSkill[]
  total: number
  revision: number
  loading: boolean
  enabled: boolean
  hasMore: boolean
  loadMore: () => void
}

function canQuerySkills(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.querySkills === 'function'
}

export function useSkillsQuery({
  workspaceId,
  workingDirectory,
  query = '',
  limit = SKILLS_UI_PAGE_SIZE,
  enabled,
  sources,
}: UseSkillsQueryArgs): UseSkillsQueryResult {
  const active = Boolean(workspaceId) && (enabled ?? canQuerySkills())
  const [page, setPage] = React.useState<SkillsQueryPage>(emptySkillsQueryPage)
  const [windowLimit, setWindowLimit] = React.useState(() => capSkillsLimit(limit))
  const [loading, setLoading] = React.useState(false)
  const pageRef = React.useRef(page)
  pageRef.current = page
  const queryRef = React.useRef(query)
  queryRef.current = query

  React.useEffect(() => {
    setWindowLimit(capSkillsLimit(limit))
  }, [workspaceId, workingDirectory, query, limit, sources?.join(',')])

  React.useEffect(() => {
    if (!active || !workspaceId) {
      setPage(emptySkillsQueryPage())
      setLoading(false)
      return
    }
    let cancelled = false
    let generation = 0
    const api = window.electronAPI
    const run = async (nextLimit: number) => {
      const request = ++generation
      setLoading(true)
      try {
        const result = await readSkillsPage(api, {
          workspaceId,
          workingDirectory,
          query,
          offset: 0,
          limit: nextLimit,
          sources,
        })
        if (!cancelled && request === generation) setPage(result)
      } catch {
        if (!cancelled && request === generation) setPage(emptySkillsQueryPage())
      } finally {
        if (!cancelled && request === generation) setLoading(false)
      }
    }
    const timer = window.setTimeout(() => { void run(windowLimit) }, SKILLS_UI_QUERY_DEBOUNCE_MS)
    const off = api.onSkillsChanged?.((changedWorkspaceId: string, payload?: SkillsChangedDelta) => {
      if (cancelled || changedWorkspaceId !== workspaceId) return
      const delta = payload ?? { revision: pageRef.current.revision + 1, changed: [], removed: [] }
      const current = pageRef.current
      if (!payload || shouldRefetchSkillsPage(current.revision, delta)) {
        void run(windowLimit)
        return
      }
      const visible = new Set(current.items.map((skill) => skill.slug))
      const changedVisible = delta.changed.filter((slug) => visible.has(slug))
      const removedVisible = delta.removed.some((slug) => visible.has(slug))
      const fetchSlugs = delta.changed
      if (fetchSlugs.length === 0 && !removedVisible && changedVisible.length === 0) {
        setPage((prev) => ({ ...prev, revision: delta.revision }))
        return
      }
      void readSkillsPage(api, {
        workspaceId,
        workingDirectory,
        slugs: fetchSlugs.length ? fetchSlugs : undefined,
        query: fetchSlugs.length ? undefined : queryRef.current,
        limit: capSkillsLimit(fetchSlugs.length || windowLimit),
        sources,
      }).then((fetched) => {
        if (cancelled) return
        setPage((prev) => applySkillsChangedDelta({
          page: prev,
          delta,
          fetchedChanged: fetched.items,
          query: queryRef.current,
          cap: windowLimit,
        }))
      }).catch(() => { void run(windowLimit) })
    })
    return () => {
      cancelled = true
      generation += 1
      window.clearTimeout(timer)
      off?.()
    }
  }, [active, workspaceId, workingDirectory, query, windowLimit, sources?.join(',')])

  const loadMore = React.useCallback(() => {
    setWindowLimit((current) => {
      if (page.total > 0 && current >= page.total) return current
      return capSkillsLimit(current + SKILLS_UI_PAGE_SIZE)
    })
  }, [page.total])

  return {
    items: page.items,
    total: page.total,
    revision: page.revision,
    loading,
    enabled: active,
    hasMore: page.items.length < page.total && page.items.length < SKILLS_UI_ACCUMULATE_CAP,
    loadMore,
  }
}
