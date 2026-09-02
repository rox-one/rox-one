import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Archive, Flag, X } from 'lucide-react'
import { PremiumMenuSelect } from '@craft-agent/ui'
import type { BulkUpdateSessionsPatch, SessionPriority } from '@craft-agent/shared/protocol/dto'
import { sessionSelection } from '@/hooks/useEntitySelection'
import { useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import type { SessionStatus, SessionStatusId } from '@/config/session-status-config'
import { cn } from '@/lib/utils'
import { NO_PROJECT_VALUE, projectPatchForBulkValue } from './bulk-input'

export interface CollectionBulkBarProps {
  workspaceId: string | null | undefined
  statuses?: SessionStatus[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
}

const STATUSES_QUICK: SessionStatusId[] = ['todo', 'in-progress', 'needs-review', 'done', 'cancelled']
const PRIORITIES: SessionPriority[] = ['none', 'urgent', 'high', 'medium', 'low']


/** Bottom-center floating bulk actions for sessions multi-select. */
export function CollectionBulkBar({
  workspaceId,
  statuses = [],
  projects = [],
  labels = [],
  className,
}: CollectionBulkBarProps) {
  const { t } = useTranslation()
  const active = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const count = useSelectionCount()
  const selection = sessionSelection.useSelection()
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selection.clearMultiSelect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, selection])

  const apply = React.useCallback(
    async (patch: BulkUpdateSessionsPatch) => {
      if (!workspaceId || selectedIds.size === 0) return
      setBusy(true)
      try {
        const res = await window.electronAPI.bulkUpdateSessions({
          workspaceId,
          ids: [...selectedIds],
          patch,
        })
        if (res.failed.length > 0) {
          toast.error(t('collection.bulk.partial', { count: res.failed.length }))
        } else {
          toast.success(t('collection.bulk.applied', { count: res.ok.length }))
        }
        selection.reset()
      } catch (e) {
        toast.error(
          t('collection.bulk.failed', {
            message: e instanceof Error ? e.message : String(e),
          }),
        )
      } finally {
        setBusy(false)
      }
    },
    [workspaceId, selectedIds, selection, t],
  )



  if (!active || !workspaceId) return null

  const statusOptions: SessionStatusId[] =
    statuses.length > 0 ? (statuses.map((s) => s.id) as SessionStatusId[]) : STATUSES_QUICK

  return (
    <div
      className={cn('pointer-events-auto fixed inset-x-0 bottom-6 z-50 flex justify-center', className)}
      role="toolbar"
      aria-label={t('collection.bulk.title')}
    >
      <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-modal-small backdrop-blur">
        <span className="text-xs font-semibold text-foreground/90">
          {t('collection.bulk.selected', { count })}
        </span>

        <PremiumMenuSelect
          variant="compact"
          searchable={false}
          disabled={busy}
          placeholder={t('collection.bulk.setStatus')}
          items={statusOptions.map((status) => ({
            id: status,
            label: t(`kanban.column.${status}`, { defaultValue: status }),
          }))}
          onSelect={(item) => {
            void apply({ sessionStatus: item.id as SessionStatusId })
          }}
        />

        <PremiumMenuSelect
          variant="compact"
          searchable={false}
          disabled={busy}
          placeholder={t('collection.bulk.setPriority')}
          items={PRIORITIES.map((priority) => ({
            id: priority,
            label: t(`priority.${priority}`),
          }))}
          onSelect={(item) => {
            void apply({ priority: item.id as SessionPriority })
          }}
        />

        {projects.length > 0 && (
          <PremiumMenuSelect
            variant="compact"
            searchable={projects.length > 12}
            disabled={busy}
            placeholder={t('collection.bulk.setProject')}
            items={[
              { id: NO_PROJECT_VALUE, label: t('collection.bulk.noProject') },
              ...projects.map((project) => ({ id: project.id, label: project.name })),
            ]}
            onSelect={(item) => {
              const patch = projectPatchForBulkValue(item.id)
              if (patch) void apply(patch)
            }}
          />
        )}
        {labels.length > 0 && (
          <PremiumMenuSelect
            variant="compact"
            searchable={labels.length > 12}
            disabled={busy}
            aria-label={t('collection.bulk.addLabel')}
            placeholder={t('collection.bulk.addLabel')}
            items={labels.map((label) => ({ id: label.id, label: label.name }))}
            onSelect={(item) => {
              void apply({ addLabels: [item.id] })
            }}
          />
        )}

        {labels.length > 0 && (
          <PremiumMenuSelect
            variant="compact"
            searchable={labels.length > 12}
            disabled={busy}
            aria-label={t('collection.bulk.removeLabel')}
            placeholder={t('collection.bulk.removeLabel')}
            items={labels.map((label) => ({ id: label.id, label: label.name }))}
            onSelect={(item) => {
              void apply({ removeLabels: [item.id] })
            }}
          />
        )}

        <input
          type="date"
          aria-label={t('collection.bulk.setDueDate')}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value
            e.target.value = ''
            if (!value) {
              void apply({ dueDate: null })
              return
            }
            const [year, month, day] = value.split('-').map(Number)
            const dueDate = Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0)
            if (Number.isFinite(dueDate)) void apply({ dueDate })
          }}
        />


        <button
          type="button"
          disabled={busy}
          onClick={() => void apply({ isFlagged: true })}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          <Flag className="h-3.5 w-3.5" /> {t('collection.bulk.flag')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void apply({ isFlagged: false })}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          {t('collection.bulk.unflag')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t('collection.bulk.confirmArchive', { count }))) {
              void apply({ isArchived: true })
            }
          }}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          <Archive className="h-3.5 w-3.5" /> {t('collection.bulk.archive')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => selection.clearMultiSelect()}
          aria-label={t('collection.bulk.clear')}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> {t('collection.bulk.clear')}
        </button>
      </div>
    </div>
  )
}
