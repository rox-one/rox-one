/**
 * NotesImportButton — owner-driven folder import (RX-TSK-0411, RX-DOC-0029
 * FR-4 consent + FR-6 materialization).
 *
 * Flow: pick a local folder → bounded preview (file list + limits) → explicit
 * consent checkbox → execute copies into the workspace imports folder with a
 * provenance manifest. LOCAL_ONLY: both channels are routed to the local
 * server only. Indexing/agent-context (FR-7) is intentionally NOT part of
 * this flow.
 */

import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FolderInput, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useDirectoryPicker } from '@/hooks/useDirectoryPicker'
import { RPC_CHANNELS } from '../../../shared/types'
interface ScanNote { absolutePath: string; relativePath: string; sizeBytes: number }
interface ScanResult { root: string; notes: ScanNote[]; skippedSymlinks: number; truncated: boolean }
interface MaterializeResult { destinationDir: string; manifestPath: string; copiedCount: number; skippedCount: number }

export interface NotesImportButtonProps {
  workspaceId: string | undefined
  /** Called after a successful import so the notes tree can refresh. */
  onImported?: () => void
}

export function NotesImportButton({ workspaceId, onImported }: NotesImportButtonProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<ScanResult | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<MaterializeResult | null>(null)

  const api = window.electronAPI
  const available = Boolean(api?.isChannelAvailable?.(RPC_CHANNELS.notesImport.PREVIEW))

  const runPreview = React.useCallback(async (path: string) => {
    if (!api) return
    setBusy(true)
    try {
      const scan = (await (api as unknown as {
        previewNotesImport: (i: { workspaceId: string; sourcePath: string }) => Promise<ScanResult>
      }).previewNotesImport({ workspaceId: workspaceId ?? '', sourcePath: path })) as ScanResult
      setPreview(scan)
      setConsent(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [api, workspaceId])

  const picker = useDirectoryPicker((path) => void runPreview(path))

  const execute = async () => {
    if (!preview || !workspaceId || !api) return
    setBusy(true)
    try {
      const res = await (api as unknown as {
        executeNotesImport: (i: { workspaceId: string; sourcePath: string }) => Promise<MaterializeResult>
      }).executeNotesImport({ workspaceId, sourcePath: preview.root })
      setResult(res)
      setPreview(null)
      onImported?.()
      toast.success(
        t('settings.notesImport.doneToast', {
          copied: res.copiedCount,
          skipped: res.skippedCount,
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!available) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={picker.pickDirectory} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FolderInput className="mr-1 h-3 w-3" />}
        {t('settings.notesImport.importButton')}
      </Button>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('settings.notesImport.previewTitle')}</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            {t('settings.notesImport.sourceLabel')}: {preview?.root}
            {preview?.truncated ? ` — ${t('settings.notesImport.truncated')}` : ''}
            {preview && preview.skippedSymlinks > 0
              ? ` — ${t('settings.notesImport.symlinksSkipped', { count: preview.skippedSymlinks })}`
              : ''}
          </p>

          <div className="max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs">
            {preview?.notes.map((n) => (
              <div key={n.absolutePath} className="flex justify-between gap-2 py-0.5">
                <span className="truncate">{n.relativePath}</span>
                <span className="text-muted-foreground">{n.sizeBytes} B</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Switch id="notes-import-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <Label htmlFor="notes-import-consent" className="text-xs text-muted-foreground">
              {t('settings.notesImport.consentLabel')}
            </Label>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!consent || busy} onClick={() => void execute()}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {t('settings.notesImport.executeButton', { count: preview?.notes.length ?? 0 })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result toast is shown via sonner; result state kept for potential inline display */}
      {result ? null : null}
    </>
  )
}
