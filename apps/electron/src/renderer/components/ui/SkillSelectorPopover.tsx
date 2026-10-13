import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, RefreshCw } from 'lucide-react'
import { FilterableSelectPopover } from '@rox/ui'

import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { readSkillsPage, SKILLS_UI_QUERY_DEBOUNCE_MS, SKILLS_UI_SEARCH_LIMIT } from '@/lib/skills-query'
import type { LoadedSkill } from '../../../shared/types'

export interface SkillSelectorPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
  skills: LoadedSkill[]
  selectedSlugs: string[]
  onToggleSlug: (slug: string) => void
  /** Workspace id — resolves local skill icons via SkillAvatar. */
  workspaceId?: string
  workingDirectory?: string
  /**
   * True while the workspace skills catalog is still syncing/pending. A slow
   * bundled-skills sync can outlive the client timeout, so an empty list must
   * not be presented as "no skills configured"; a syncing marker is shown
   * instead until the load settles. Mirrors SkillsListPanel's `syncing`.
   */
  loading?: boolean
}

/**
 * SkillSelectorPopover — skill multi-select mirroring {@link SourceSelectorPopover}.
 *
 * Searches `skills:query` when the preload exposes it so a 10k catalog never
 * enters the popover. The `skills` prop is a seed (selected rows + tests).
 */
export function SkillSelectorPopover({
  open,
  onOpenChange,
  anchorRef,
  skills,
  selectedSlugs,
  onToggleSlug,
  workspaceId,
  workingDirectory,
  loading = false,
}: SkillSelectorPopoverProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = React.useState('')
  const [queried, setQueried] = React.useState<LoadedSkill[] | null>(null)
  const [querying, setQuerying] = React.useState(false)
  const canQuery = typeof window !== 'undefined' && typeof window.electronAPI?.querySkills === 'function' && !!workspaceId

  React.useEffect(() => {
    if (!open) {
      setFilter('')
      setQueried(null)
      setQuerying(false)
      return
    }
    if (!canQuery || !workspaceId) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setQuerying(true)
      void readSkillsPage(window.electronAPI, {
        workspaceId,
        workingDirectory,
        query: filter,
        limit: SKILLS_UI_SEARCH_LIMIT,
      }).then((page) => {
        if (!cancelled) setQueried(page.items)
      }).catch(() => {
        if (!cancelled) setQueried([])
      }).finally(() => {
        if (!cancelled) setQuerying(false)
      })
    }, SKILLS_UI_QUERY_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, canQuery, workspaceId, workingDirectory, filter])

  const items = React.useMemo(() => {
    const base = queried ?? skills
    const bySlug = new Map(base.map((skill) => [skill.slug, skill]))
    for (const slug of selectedSlugs) {
      if (bySlug.has(slug)) continue
      const seed = skills.find((skill) => skill.slug === slug)
      if (seed) bySlug.set(slug, seed)
    }
    return [...bySlug.values()]
  }, [queried, skills, selectedSlugs])

  const handleFilterChange = React.useCallback((next: string) => {
    setFilter(next)
  }, [])

  return (
    <FilterableSelectPopover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      items={items}
      getKey={(skill) => skill.slug}
      getLabel={(skill) => skill.metadata.name}
      isSelected={(skill) => selectedSlugs.includes(skill.slug)}
      onToggle={(skill) => onToggleSlug(skill.slug)}
      filterPlaceholder={t('skillsList.searchPlaceholder')}
      onFilterChange={canQuery ? handleFilterChange : undefined}
      disableClientFilter={canQuery}
      emptyState={loading || querying ? (
        <span className="flex items-center gap-2" role="status" data-list-role="skills-syncing">
          <RefreshCw className="icon-caption animate-spin" />
          {t('common.loading')}
        </span>
      ) : (
        <>
          {t('skillsList.noSkillsConfigured')}
          <br />
          {t('skillsList.addInSettings')}
        </>
      )}
      noResultsState={t('skillsList.noMatching')}
      minWidth={200}
      maxWidth={320}
      renderItem={(skill, state) => (
        <div
          className={cn(
            'flex cursor-pointer select-none items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-base',
            state.highlighted && 'bg-foreground/5',
            state.selected && 'bg-foreground/3',
          )}
        >
          <div className="shrink-0 text-muted-foreground flex items-center">
            <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />
          </div>
          <div className="flex-1 min-w-0 truncate" title={skill.metadata.name}>{skill.metadata.name}</div>
          <div
            className={cn(
              'shrink-0 h-4 w-4 rounded-full bg-current flex items-center justify-center',
              !state.selected && 'opacity-0',
            )}
          >
            <Check className="h-2.5 w-2.5 text-white dark:text-black" strokeWidth={3} />
          </div>
        </div>
      )}
    />
  )
}
