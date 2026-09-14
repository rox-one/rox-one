import * as React from 'react'
import { useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Archive, Flag, Layers, X } from 'lucide-react'
import {
  BULK_UPDATE_MAX_IDS,
  type BulkUpdateSessionsPatch,
  type SessionPriority,
} from '@craft-agent/shared/protocol'
import { extractSessionMeta, sessionMetaMapAtom } from '@/atoms/sessions'
import { sessionSelection } from '@/hooks/useEntitySelection'
import type { SessionStatus, SessionStatusId } from '@/config/session-status-config'
import { cn } from '@/lib/utils'
import { NO_PROJECT_VALUE, projectPatchForBulkValue } from './bulk-input'
import { bulkStatusColumnLabel } from './bulk-status-label'
import { CollectionBulkMenu } from './CollectionBulkMenu'
import {
  applyOptimisticCollectionBulkOperation,
  assessBulkUpdateOutcome,
  collectionBulkOperationRegistry,
  createOptimisticCollectionBulkOperation,
  rollbackMatchingCollectionBulkOperation,
  snapshotVisibleEligibleSelection,
  type OptimisticCollectionBulkOperation,
  type VisibleBulkSelectionSnapshot,
} from './collection-bulk-optimistic'
import {
  mapReduceProductResult,
  mapReduceVisibleSessions,
} from './collection-map-reduce'
import { isClaimableLive } from '@craft-agent/core/rox2'

export interface CollectionBulkBarProps {
  workspaceId: string | null | undefined
  /** Eligible, rendered sessions in this collection host's exact visual order. */
  visibleSessionIds: readonly string[]
  statuses?: SessionStatus[]
  projects?: Array<{ id: string; name: string }>
  labels?: Array<{ id: string; name: string }>
  className?: string
}

const STATUSES_QUICK: SessionStatusId[] = ['todo', 'in-progress', 'needs-review', 'done', 'cancelled']
const PRIORITIES: SessionPriority[] = ['none', 'urgent', 'high', 'medium', 'low']
const BULK_REQUEST_TIMEOUT_MS = 15_000

/** Bottom-center floating bulk actions for sessions multi-select. */
export function CollectionBulkBar({
  workspaceId,
  visibleSessionIds,
  statuses = [],
  projects = [],
  labels = [],
  className,
}: CollectionBulkBarProps) {
  const { t, i18n } = useTranslation()
  const store = useStore()
  const selection = sessionSelection.useSelection()
  const [busy, setBusy] = React.useState(false)
  const inFlightCountRef = React.useRef(0)

  const visibleSelection = React.useMemo(
    () => snapshotVisibleEligibleSelection(selection.state.selectedIds, visibleSessionIds),
    [selection.state.selectedIds, visibleSessionIds],
  )

  React.useEffect(() => {
    if (!selection.isMultiSelectActive) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selection.clearMultiSelect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, selection.isMultiSelectActive])

  const refreshUnknownOperation = React.useCallback(
    async (operation: OptimisticCollectionBulkOperation) => {
      const sessions = await window.electronAPI.getSessions()
      const authoritativeById = new Map(
        sessions
          .filter(session => session.workspaceId === workspaceId)
          .map(session => [session.id, extractSessionMeta(session)] as const),
      )
      const currentMetaMap = store.get(sessionMetaMapAtom)
      const nextMetaMap = new Map(currentMetaMap)
      let changed = false

      for (const id of operation.targetIds) {
        if (!collectionBulkOperationRegistry.isCurrent(operation, id)) continue
        const authoritative = authoritativeById.get(id)
        if (authoritative) nextMetaMap.set(id, authoritative)
        else nextMetaMap.delete(id)
        changed = true
      }
      if (changed) store.set(sessionMetaMapAtom, nextMetaMap)
    },
    [store, workspaceId],
  )

  const dispatchAccepted = React.useCallback(
    async (patch: BulkUpdateSessionsPatch, accepted: VisibleBulkSelectionSnapshot) => {
      if (!workspaceId || accepted.count === 0) return
      if (accepted.count > BULK_UPDATE_MAX_IDS) {
        toast.error(t('collection.bulk.failed', { message: 'bulk_limit' }))
        return
      }

      // Targets, disclosed count, before-values, and projections are captured
      // synchronously before any await.
      const operation = createOptimisticCollectionBulkOperation(
        collectionBulkOperationRegistry.nextId(),
        store.get(sessionMetaMapAtom),
        accepted.ids,
        patch,
      )
      if (!operation) {
        toast.error(t('collection.bulk.failed', { message: 'bulk_target_unavailable' }))
        return
      }

      collectionBulkOperationRegistry.begin(operation)
      const optimisticMetaMap = applyOptimisticCollectionBulkOperation(
        store.get(sessionMetaMapAtom),
        operation,
      )
      const optimisticMetaById = new Map(
        operation.targetIds.flatMap((id) => {
          const meta = optimisticMetaMap.get(id)
          return meta ? [[id, meta] as const] : []
        }),
      )
      const rollbackTargets = (targetIds: readonly string[]) => {
        const currentMetaMap = store.get(sessionMetaMapAtom)
        const restoredMetaMap = new Map(currentMetaMap)
        let restored = false
        for (const id of targetIds) {
          if (!collectionBulkOperationRegistry.isCurrent(operation, id)) continue
          const current = currentMetaMap.get(id)
          const snapshot = operation.snapshotsById.get(id)
          const expectedOptimisticMeta = optimisticMetaById.get(id)
          if (!current || !snapshot || !expectedOptimisticMeta) continue
          const rollback = rollbackMatchingCollectionBulkOperation(
            current,
            snapshot,
            expectedOptimisticMeta,
          )
          if (Object.keys(rollback).length === 0) continue
          restoredMetaMap.set(id, { ...current, ...rollback })
          restored = true
        }
        if (restored) store.set(sessionMetaMapAtom, restoredMetaMap)
      }
      store.set(sessionMetaMapAtom, optimisticMetaMap)

      inFlightCountRef.current += 1
      setBusy(true)
      let timeout: number | undefined

      try {
        const request = window.electronAPI.bulkUpdateSessions({
          workspaceId,
          ids: [...operation.targetIds],
          patch,
        })
        const result = await Promise.race([
          request,
          new Promise<never>((_resolve, reject) => {
            timeout = window.setTimeout(
              () => reject(new Error('bulk_timeout')),
              BULK_REQUEST_TIMEOUT_MS,
            )
          }),
        ])
        const assessment = assessBulkUpdateOutcome(operation.targetIds, result)
        if (!assessment.valid) {
          rollbackTargets(operation.targetIds)
          await refreshUnknownOperation(operation).catch(() => undefined)
          toast.error(t('collection.bulk.failed', { message: assessment.reason }))
          return
        }

        const currentOkIds = assessment.okIds.filter(id =>
          collectionBulkOperationRegistry.isCurrent(operation, id))
        const currentFailedIds = assessment.failedIds.filter(id =>
          collectionBulkOperationRegistry.isCurrent(operation, id))

        rollbackTargets(currentFailedIds)


        if (currentOkIds.length > 0) {
          selection.removeFromSelection([...currentOkIds])
        }
        await refreshUnknownOperation(operation).catch(() => undefined)
        if (assessment.failedIds.length > 0) {
          toast.error(t('collection.bulk.partial', { count: assessment.failedIds.length }))
        } else {
          toast.success(t('collection.bulk.applied', { count: assessment.okIds.length }))
        }
      } catch (error) {
        // Unknown transport outcomes still restore only this operation's exact
        // projections; the authoritative read then resolves a late commit.
        rollbackTargets(operation.targetIds)
        await refreshUnknownOperation(operation).catch(() => undefined)
        toast.error(
          t('collection.bulk.failed', {
            message: error instanceof Error ? error.message : String(error),
          }),
        )
      } finally {
        for (const id of operation.targetIds) {
          collectionBulkOperationRegistry.resolve(operation, id)
        }
        window.clearTimeout(timeout)
        inFlightCountRef.current -= 1
        setBusy(inFlightCountRef.current > 0)
      }
    },
    [refreshUnknownOperation, selection, store, t, workspaceId],
  )

  const apply = React.useCallback(
    (patch: BulkUpdateSessionsPatch) => {
      const accepted = snapshotVisibleEligibleSelection(
        selection.state.selectedIds,
        visibleSessionIds,
      )
      void dispatchAccepted(patch, accepted)
    },
    [dispatchAccepted, selection.state.selectedIds, visibleSessionIds],
  )

  const applyArchive = React.useCallback(() => {
    const accepted = snapshotVisibleEligibleSelection(
      selection.state.selectedIds,
      visibleSessionIds,
    )
    if (accepted.count === 0) return
    if (window.confirm(t('collection.bulk.confirmArchive', { count: accepted.count }))) {
      void dispatchAccepted({ isArchived: true }, accepted)
    }
  }, [dispatchAccepted, selection.state.selectedIds, t, visibleSessionIds])

  const applyMapReduce = React.useCallback(async () => {
    const accepted = snapshotVisibleEligibleSelection(
      selection.state.selectedIds,
      visibleSessionIds,
    )
    if (accepted.count === 0) return
    setBusy(true)
    try {
      const result = await mapReduceVisibleSessions({
        ids: accepted.ids,
        metaById: store.get(sessionMetaMapAtom),
      })
      if (isClaimableLive(mapReduceProductResult(result))) {
        toast.success(t('collection.bulk.mapDone', { count: result.outcomes.length }))
      } else {
        toast.message(t('collection.bulk.mapPartial', {
          included: result.coverage.included,
          selected: result.coverage.selected,
        }))
      }
    } catch (error) {
      toast.error(
        t('collection.bulk.mapFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setBusy(false)
    }
  }, [selection.state.selectedIds, store, t, visibleSessionIds])

  if (!selection.isMultiSelectActive || !workspaceId || visibleSelection.count === 0) {
    return null
  }

  const statusOptions: SessionStatusId[] =
    statuses.length > 0 ? (statuses.map(status => status.id) as SessionStatusId[]) : STATUSES_QUICK

  return (
    <div
      className={cn('pointer-events-auto fixed inset-x-0 bottom-6 z-50 flex justify-center', className)}
      role="toolbar"
      aria-label={`${t('collection.bulk.title')}: ${t('collection.bulk.selected', { count: visibleSelection.count })}`}
    >
      <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-modal-small backdrop-blur">
        <span className="text-xs font-semibold text-foreground/90" aria-live="polite">
          {t('collection.bulk.selected', { count: visibleSelection.count })}
        </span>

        <CollectionBulkMenu
          label={t('collection.bulk.setStatus')}
          disabled={busy}
          items={statusOptions.map((status) => ({
            id: status,
            label: bulkStatusColumnLabel(status, (key) => t(key), (key) => i18n.exists(key)),
          }))}
          onPick={(id) => apply({ sessionStatus: id as SessionStatusId })}
        />

        <CollectionBulkMenu
          label={t('collection.bulk.setPriority')}
          disabled={busy}
          items={PRIORITIES.map((priority) => ({
            id: priority,
            label: t(`priority.${priority}`),
          }))}
          onPick={(id) => apply({ priority: id as SessionPriority })}
        />

        {projects.length > 0 && (
          <CollectionBulkMenu
            label={t('collection.bulk.setProject')}
            disabled={busy}
            items={[
              { id: NO_PROJECT_VALUE, label: t('collection.bulk.noProject') },
              ...projects.map((project) => ({ id: project.id, label: project.name })),
            ]}
            onPick={(id) => {
              const patch = projectPatchForBulkValue(id)
              if (patch) apply(patch)
            }}
          />
        )}

        {labels.length > 0 && (
          <CollectionBulkMenu
            label={t('collection.bulk.addLabel')}
            disabled={busy}
            items={labels.map((label) => ({ id: label.id, label: label.name }))}
            onPick={(id) => apply({ addLabels: [id] })}
          />
        )}

        {labels.length > 0 && (
          <CollectionBulkMenu
            label={t('collection.bulk.removeLabel')}
            disabled={busy}
            items={labels.map((label) => ({ id: label.id, label: label.name }))}
            onPick={(id) => apply({ removeLabels: [id] })}
          />
        )}

        <input
          type="date"
          aria-label={t('collection.bulk.setDueDate')}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value
            event.target.value = ''
            if (!value) {
              apply({ dueDate: null })
              return
            }
            const [year, month, day] = value.split('-').map(Number)
            const dueDate = Date.UTC(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0)
            if (Number.isFinite(dueDate)) apply({ dueDate })
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => void applyMapReduce()}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          <Layers className="h-3.5 w-3.5" /> {t('collection.bulk.map')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => apply({ isFlagged: true })}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          <Flag className="h-3.5 w-3.5" /> {t('collection.bulk.flag')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => apply({ isFlagged: false })}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-foreground/80 hover:bg-foreground/[0.03]"
        >
          {t('collection.bulk.unflag')}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={applyArchive}
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
