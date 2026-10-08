/**
 * W1-13 (#1510) review 2: shows this launch's visible-home migration result
 * once (Electron main hands the notice out a single time, to the first
 * managed window that asks):
 * - migrated/merged: `storage.migratedToast` + `storage.legacySymlink`;
 * - merge conflicts: the files kept under `~/rox/.migration/conflicts`;
 * - foreign `~/rox`: why nothing moved.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { StorageMigrationNotice } from '../../../shared/storage-visible-root'

const MAX_LISTED_CONFLICTS = 5

export function formatConflictList(conflicts: string[], max = MAX_LISTED_CONFLICTS): string {
  const listed = conflicts.slice(0, max).join(', ')
  return conflicts.length > max ? `${listed}, +${conflicts.length - max}` : listed
}

interface Notifier {
  success(message: string, options?: { description?: string; duration?: number }): unknown
  warning(message: string, options?: { description?: string; duration?: number }): unknown
}

export function showStorageMigrationNotice(
  notice: StorageMigrationNotice,
  t: (key: string, options?: Record<string, unknown>) => string,
  notify: Notifier = toast,
): void {
  if (notice.kind === 'deferred-foreign') {
    notify.warning(t('storage.notice.foreignDeferred'), { duration: 15_000 })
    return
  }
  notify.success(t('storage.migratedToast'), { description: t('storage.legacySymlink') })
  if (notice.conflicts.length > 0) {
    notify.warning(t('storage.notice.conflicts', { files: formatConflictList(notice.conflicts) }), { duration: 15_000 })
  }
}

export function StorageMigrationNotices(): null {
  const { t } = useTranslation()
  useEffect(() => {
    // One-shot on the main side, so no cancellation: a StrictMode re-run just
    // receives null.
    window.electronAPI?.takeStorageMigrationNotice?.()
      .then((notice) => {
        if (notice) showStorageMigrationNotice(notice, t)
      })
      .catch(() => {
        // non-Electron host or older main: nothing to show
      })
  }, [t])
  return null
}
