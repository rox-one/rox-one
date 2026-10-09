/**
 * ImportReviewDialog — разбор правок, найденных в репозитории памяти.
 *
 * Lists the edits returned by `previewMemoryRepoImport` (path, kind, conflict
 * badges and a unified diff preview) and applies only the checked edits. A
 * conflicting edit is applied only when its «Переопределить» box is checked.
 * Revert always goes through an explicit confirmation.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { UnifiedDiffViewer } from '@rox/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { MemoryRepoImportEdit, MemoryRepoImportPreview } from '@rox/shared/memory/repo'
import { cn } from '@/lib/utils'
import { toErrorMessage } from '@/lib/errors'

export interface ImportReviewDialogProps {
  bankId: string
  open: boolean
  onOpenChange(open: boolean): void
  onApplied?(paths: string[]): void
  onReverted?(): void
}

const CONFLICT_KEY: Record<NonNullable<MemoryRepoImportEdit['conflict']>, string> = {
  'rule-changed': 'memory.repo.import.conflictRuleChanged',
  'unknown-id': 'memory.repo.import.conflictUnknownId',
  'deleted': 'memory.repo.import.conflictDeleted',
}

function KindBadge({ kind }: { kind: MemoryRepoImportEdit['kind'] }) {
  const { t } = useTranslation()
  return (
    <span data-testid="import-edit-kind" className={cn(
      'shrink-0 rounded-[var(--radius-control)] px-1.5 py-0.5 text-[11px]',
      kind === 'add' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : kind === 'delete' ? 'bg-destructive/12 text-destructive'
        : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    )}>
      {t(`memory.repo.import.kind.${kind}`)}
    </span>
  )
}

export function ImportReviewDialog({ bankId, open, onOpenChange, onApplied, onReverted }: ImportReviewDialogProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = React.useState<MemoryRepoImportPreview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [overrides, setOverrides] = React.useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [confirmRevert, setConfirmRevert] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (typeof window.electronAPI.previewMemoryRepoImport !== 'function') return
    let cancelled = false
    setLoading(true)
    setFailed(false)
    setConfirmRevert(false)
    window.electronAPI.previewMemoryRepoImport(bankId).then((result) => {
      if (cancelled) return
      setPreview(result)
      setSelected(new Set(result.edits.map((edit) => edit.path)))
      setOverrides(new Set())
    }).catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, bankId])

  const edits = preview?.edits ?? []
  const checkedPaths = edits
    .filter((edit) => selected.has(edit.path) && (!edit.conflict || overrides.has(edit.path)))
    .map((edit) => edit.path)

  const toggle = (set: ReadonlySet<string>, path: string): Set<string> => {
    const next = new Set(set)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  }

  const apply = () => {
    if (busy || checkedPaths.length === 0 || typeof window.electronAPI.applyMemoryRepoImport !== 'function') return
    const paths = checkedPaths
    setBusy(true)
    window.electronAPI.applyMemoryRepoImport(bankId, paths).then(() => {
      toast.success(t('memory.repo.import.applied'))
      onApplied?.(paths)
      onOpenChange(false)
    }).catch((error) => toast.error(t('memory.repo.import.failed'), { description: toErrorMessage(error) }))
      .finally(() => setBusy(false))
  }

  const revert = () => {
    if (busy || typeof window.electronAPI.revertMemoryRepoImport !== 'function') return
    setBusy(true)
    window.electronAPI.revertMemoryRepoImport(bankId).then(() => {
      toast.success(t('memory.repo.import.reverted'))
      onReverted?.()
      setConfirmRevert(false)
      onOpenChange(false)
    }).catch((error) => toast.error(t('memory.repo.import.revertFailed'), { description: toErrorMessage(error) }))
      .finally(() => setBusy(false))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-3xl" data-testid="import-review-dialog">
        <DialogHeader>
          <DialogTitle>{t('memory.repo.import.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('memory.repo.import.description')}</DialogDescription>
        </DialogHeader>
        {confirmRevert ? (
          <div className="rounded-[var(--radius-control)] border border-destructive/20 bg-destructive/5 p-3" data-testid="import-revert-confirm">
            <p className="text-sm font-medium">{t('memory.repo.import.revertTitle')}</p>
            <p className="mt-1 text-xs text-text-secondary">{t('memory.repo.import.revertBody')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmRevert(false)}>{t('memory.cancel')}</Button>
              <Button variant="destructive" size="sm" disabled={busy} onClick={revert} data-testid="import-revert-confirm-button">{t('memory.repo.import.revertConfirm')}</Button>
            </div>
          </div>
        ) : loading ? (
          <p className="py-6 text-center text-xs text-text-muted">{t('memory.screen.loading')}</p>
        ) : failed ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">{t('memory.repo.import.loadFailed')}</p>
        ) : edits.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted" data-testid="import-empty">{t('memory.repo.import.empty')}</p>
        ) : (
          <ul className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto" data-testid="import-edit-list">
            {edits.map((edit) => {
              const pending = selected.has(edit.path)
              const overridden = overrides.has(edit.path)
              return (
                <li key={edit.path} data-testid="import-edit" data-path={edit.path} className="rounded-[var(--radius-control)] border border-foreground/8 bg-foreground/[0.02] p-2">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={pending}
                      onChange={() => setSelected((prev) => toggle(prev, edit.path))}
                      aria-label={`${t('memory.repo.import.select')}: ${edit.path}`}
                      data-testid="import-edit-select"
                      className="size-3.5 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">{edit.path}</span>
                    <KindBadge kind={edit.kind} />
                    {edit.conflict ? (
                      <span data-testid="import-conflict" className="shrink-0 rounded-[var(--radius-control)] bg-amber-500/12 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        {t(CONFLICT_KEY[edit.conflict])}
                      </span>
                    ) : null}
                  </div>
                  {edit.conflict ? (
                    <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={overridden}
                        onChange={() => setOverrides((prev) => toggle(prev, edit.path))}
                        data-testid="import-edit-override"
                        className="size-3.5 accent-[var(--accent)]"
                      />
                      {t('memory.repo.import.override')}
                    </label>
                  ) : null}
                  {edit.diff ? (
                    <div className="mt-2 max-h-[240px] overflow-auto rounded-[var(--radius-control)] border border-foreground/8" data-testid="import-edit-diff">
                      <UnifiedDiffViewer unifiedDiff={edit.diff} filePath={edit.path} diffStyle="unified" />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {confirmRevert ? null : (
          <DialogFooter>
            <Button variant="destructive" disabled={busy} onClick={() => setConfirmRevert(true)} data-testid="import-revert">{t('memory.repo.import.revert')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)} data-testid="import-cancel">{t('memory.cancel')}</Button>
            <Button disabled={busy || checkedPaths.length === 0} onClick={apply} data-testid="import-apply">
              {t('memory.repo.import.applyCount', { count: checkedPaths.length })}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}