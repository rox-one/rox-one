/**
 * AutomationsListPanel
 *
 * Navigator column for automations: search + «Новая автоматизация», then a
 * compact list grouped by trigger type (По расписанию / По событиям /
 * Агентные). Each row shows the name, a human trigger summary
 * («каждый день в 9:00», «когда добавлена метка urgent»), the last run
 * status/time and an on/off switch.
 *
 * Supports CMD/CTRL+click multi-select and Shift+click range select via the
 * shared automationSelection store (MultiSelectPanel on the right).
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { automationSelection } from '@/hooks/useEntitySelection'
import {
  AUTOMATION_GROUPS,
  describeTrigger,
  getAutomationGroup,
  getEventDisplayName,
  type AutomationGroup,
  type AutomationListFilter,
  type AutomationListItem,
  type AutomationTrigger,
} from './types'
import { formatShortRelativeTime } from './utils'
import './automations.css'

const { useSelection: useAutomationSelection } = automationSelection

const GROUP_TITLE_KEYS: Record<AutomationGroup, string> = {
  scheduled: 'automations.groupScheduled',
  event: 'automations.groupEvent',
  agent: 'automations.groupAgent',
}

const FILTER_TO_GROUP: Record<string, AutomationGroup | undefined> = {
  scheduled: 'scheduled',
  app: 'event',
  agent: 'agent',
}

/** Default event for a new automation created while a group filter is active. */
const NEW_EVENT_FOR_GROUP: Record<AutomationGroup, AutomationTrigger> = {
  scheduled: 'SchedulerTick',
  event: 'LabelAdd',
  agent: 'SessionEnd',
}

export function AutomationSwitch({
  checked,
  onToggle,
  label,
}: {
  checked: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="rox-autom-switch"
      data-testid="automation-switch"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    />
  )
}

export function LastRunMeta({ automation }: { automation: AutomationListItem }) {
  const { t } = useTranslation()
  if (!automation.lastExecutedAt) {
    return <span className="rox-autom-row-meta">{t('automations.neverRan')}</span>
  }
  const failed = automation.lastRunOk === false
  return (
    <span
      className="rox-autom-row-meta"
      title={t('automations.lastRan', { time: new Date(automation.lastExecutedAt).toLocaleString() })}
    >
      <span className={cn('rox-autom-dot', failed ? 'is-error' : 'is-ok')} aria-hidden />
      {failed ? t('automations.lastRunFailed') : null}
      {formatShortRelativeTime(automation.lastExecutedAt, t)}
    </span>
  )
}

export interface AutomationsListPanelProps {
  automations: AutomationListItem[]
  automationFilter?: AutomationListFilter | null
  onAutomationClick: (automationId: string) => void
  onDeleteAutomation?: (automationId: string) => void
  onToggleAutomation?: (automationId: string) => void
  onTestAutomation?: (automationId: string) => void
  onDuplicateAutomation?: (automationId: string) => void
  selectedAutomationId?: string | null
  workspaceRootPath?: string
  className?: string
}

export function AutomationsListPanel({
  automations,
  automationFilter,
  onAutomationClick,
  onToggleAutomation,
  selectedAutomationId,
  className,
}: AutomationsListPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const { activeWorkspaceId } = useAppShellContext()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const {
    select: selectAutomation,
    toggle: toggleAutomationSelection,
    selectRange,
    isMultiSelectActive,
    isSelected: isInSelection,
  } = useAutomationSelection()

  const onlyGroup = FILTER_TO_GROUP[automationFilter?.kind ?? 'all']

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const byGroup: Record<AutomationGroup, AutomationListItem[]> = { scheduled: [], event: [], agent: [] }
    for (const a of automations) {
      const group = getAutomationGroup(a.event)
      if (onlyGroup && group !== onlyGroup) continue
      if (q) {
        const haystack = [
          a.name,
          describeTrigger(a, t, locale),
          getEventDisplayName(a.event, t),
          ...a.actions.map((x) => (x.type === 'prompt' ? x.prompt : x.url)),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) continue
      }
      byGroup[group].push(a)
    }
    // Enabled first, then by name — stable, so rows don't jump after each run.
    for (const g of AUTOMATION_GROUPS) {
      byGroup[g].sort((a, b) => Number(b.enabled && !b.contextPause) - Number(a.enabled && !a.contextPause) || a.name.localeCompare(b.name, locale))
    }
    return byGroup
  }, [automations, query, onlyGroup, t, locale])

  const flatIds = React.useMemo(
    () => AUTOMATION_GROUPS.flatMap((g) => groups[g].map((a) => a.id)),
    [groups],
  )
  const visibleCount = flatIds.length

  const handleRowMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    const index = flatIds.indexOf(id)
    if (e.button === 2) return
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      toggleAutomationSelection(id, index)
      return
    }
    if (e.shiftKey) {
      e.preventDefault()
      selectRange(index, flatIds)
      return
    }
    selectAutomation(id, index)
    onAutomationClick(id)
  }, [flatIds, toggleAutomationSelection, selectRange, selectAutomation, onAutomationClick])

  const handleCreate = useCallback(async () => {
    if (!activeWorkspaceId || creating) return
    setCreating(true)
    const event = NEW_EVENT_FOR_GROUP[onlyGroup ?? 'scheduled']
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    try {
      const created = await window.electronAPI.createAutomation(activeWorkspaceId, {
        event,
        matcher: {
          name: t('automations.newAutomationDefaultName'),
          enabled: false,
          ...(event === 'SchedulerTick' ? { cron: '0 9 * * *', timezone } : {}),
          permissionMode: 'safe',
          actions: [{ type: 'prompt', prompt: t('automations.newAutomationDefaultPrompt') }],
        },
      })
      setQuery('')
      onAutomationClick(created.id)
    } catch (err) {
      toast.error(t('automations.createFailed'), { description: err instanceof Error ? err.message : undefined })
    } finally {
      setCreating(false)
    }
  }, [activeWorkspaceId, creating, onlyGroup, t, onAutomationClick])

  return (
    <div className={cn('rox-autom-list', className)} data-testid="automations-list">
      <div className="rox-autom-list-top">
        <div className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 opacity-50" />
          <input
            className="rox-autom-input"
            style={{ paddingLeft: 26, paddingRight: query ? 26 : 9 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
            placeholder={t('automations.searchPlaceholder')}
            aria-label={t('automations.searchPlaceholder')}
          />
          {query && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
              onClick={() => setQuery('')}
              aria-label={t('automations.clearSearch')}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="rox-autom-btn is-icon"
          onClick={handleCreate}
          disabled={!activeWorkspaceId || creating}
          title={t('automations.newAutomation')}
          aria-label={t('automations.newAutomation')}
          data-testid="automation-new"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="pb-3" data-list-role="automations">
          {automations.length === 0 ? (
            <div className="rox-autom-empty">
              <p>{t('automations.noAutomationsConfigured')}</p>
              <button type="button" className="rox-autom-btn is-primary mt-3" onClick={handleCreate} disabled={creating}>
                <Plus className="size-3.5" />
                {t('automations.newAutomation')}
              </button>
            </div>
          ) : visibleCount === 0 ? (
            <div className="rox-autom-empty">
              <p>{t('automations.noAutomationsFound')}</p>
              {query && (
                <button type="button" className="rox-autom-link mt-1" onClick={() => setQuery('')}>
                  {t('automations.clearSearch')}
                </button>
              )}
            </div>
          ) : (
            AUTOMATION_GROUPS.map((group) => {
              const items = groups[group]
              if (items.length === 0) return null
              const enabledCount = items.filter((a) => a.enabled && !a.contextPause).length
              return (
                <section key={group} aria-label={t(GROUP_TITLE_KEYS[group])} data-group={group}>
                  <div className="rox-autom-group-title">
                    <span>{t(GROUP_TITLE_KEYS[group])}</span>
                    <span title={t('automations.enabledOfTotal', { enabled: enabledCount, total: items.length })}>
                      {enabledCount}/{items.length}
                    </span>
                  </div>
                  {items.map((automation) => {
                    const selected = selectedAutomationId === automation.id
                    const inMulti = isMultiSelectActive && isInSelection(automation.id)
                    return (
                      <div
                        key={automation.id}
                        role="option"
                        tabIndex={0}
                        aria-selected={selected}
                        data-automation-id={automation.id}
                        className={cn('rox-autom-row automation-item', (!automation.enabled || automation.contextPause) && 'is-off', inMulti && 'is-multi')}
                        onMouseDown={(e) => handleRowMouseDown(e, automation.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onAutomationClick(automation.id)
                          }
                        }}
                      >
                        <div className="rox-autom-row-main">
                          <span className="rox-autom-row-name">{automation.name}</span>
                          {automation.contextPause && <span role="status" className="truncate text-[11px] text-amber-600" title={t(automation.contextPause.reason === 'target-deleted' ? 'automations.context.pausedDeleted' : 'automations.context.pausedOutOfScope')}>
                            {t(automation.contextPause.reason === 'target-deleted' ? 'automations.context.pausedDeleted' : 'automations.context.pausedOutOfScope')}
                          </span>}
                          <span className="rox-autom-row-sub">{describeTrigger(automation, t, locale)}</span>
                        </div>
                        <LastRunMeta automation={automation} />
                        <AutomationSwitch
                          checked={automation.enabled}
                          onToggle={() => onToggleAutomation?.(automation.id)}
                          label={automation.enabled ? t('automations.menuDisable') : t('automations.menuEnable')}
                        />
                      </div>
                    )
                  })}
                </section>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
