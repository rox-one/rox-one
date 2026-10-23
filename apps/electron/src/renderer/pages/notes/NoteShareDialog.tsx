import * as React from 'react'
import { Check, Copy, Link2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { NOTE_SHARE_ROLES, noteShareUrl, type NoteShareRole, type NoteShareState, type NoteShareUpdate } from '@rox/core/docs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { toErrorMessage } from '@/lib/errors'

const ROLE_LABEL: Record<NoteShareRole, string> = { view: 'notes.share.roleView', edit: 'notes.share.roleEdit' }
const ROLE_HINT: Record<NoteShareRole, string> = { view: 'notes.share.roleViewHint', edit: 'notes.share.roleEditHint' }

/**
 * Docs step 6 — local share dialog for one note: share link on/off, view vs
 * edit role, copy, and regenerate (revoke). Metadata lives in the vault
 * sidecar via notes:getShare / notes:updateShare. No realtime collab here.
 */
export function NoteShareDialog({
  open,
  workspaceId,
  noteId,
  noteTitle,
  onOpenChange,
}: {
  open: boolean
  workspaceId: string | null
  noteId: string | null
  noteTitle?: string
  onOpenChange(open: boolean): void
}) {
  const { t } = useTranslation()
  const [share, setShare] = React.useState<NoteShareState | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const requestKey = open && workspaceId && noteId ? `${workspaceId}\u0000${noteId}` : null
  const requestKeyRef = React.useRef(requestKey)
  requestKeyRef.current = requestKey

  React.useEffect(() => {
    setShare(null)
    setError(null)
    setCopied(false)
    if (!requestKey || !workspaceId || !noteId) return
    let stale = false
    window.electronAPI.getNoteShare(workspaceId, noteId)
      .then((next) => { if (!stale) setShare(next) })
      .catch((err: unknown) => { if (!stale) setError(toErrorMessage(err)) })
    return () => { stale = true }
  }, [requestKey, workspaceId, noteId])

  const update = React.useCallback(async (patch: NoteShareUpdate) => {
    if (!workspaceId || !noteId) return
    const key = requestKeyRef.current
    setBusy(true)
    setError(null)
    try {
      const next = await window.electronAPI.updateNoteShare(workspaceId, noteId, patch)
      if (requestKeyRef.current === key) setShare(next)
    } catch (err) {
      if (requestKeyRef.current === key) setError(toErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [workspaceId, noteId])

  const url = share ? noteShareUrl(share) : null
  const enabled = share?.link.enabled ?? false
  const role = share?.link.role ?? 'view'

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t('notes.share.copied'))
    } catch {
      toast.error(t('notes.share.copyFailed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && busy) return; onOpenChange(next) }}>
      <DialogContent data-testid="notes-share-dialog">
        <DialogHeader>
          <DialogTitle>{t('notes.share.title')}</DialogTitle>
          <DialogDescription>{noteTitle ? t('notes.share.description', { title: noteTitle }) : t('notes.share.localHint')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-hover p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Link2 className="icon-toolbar shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm">{t('notes.share.linkToggle')}</span>
            </div>
            <Switch
              data-testid="notes-share-toggle"
              checked={enabled}
              disabled={!share || busy}
              onCheckedChange={(checked) => { void update({ enabled: checked }) }}
              aria-label={t('notes.share.linkToggle')}
            />
          </div>

          <fieldset className="flex flex-col gap-1" disabled={!share || busy} data-testid="notes-share-roles">
            <legend className="mb-1 text-xs font-semibold uppercase caps-label text-muted-foreground">{t('notes.share.roleLabel')}</legend>
            {NOTE_SHARE_ROLES.map((option) => (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover',
                  role === option && 'bg-surface-selected',
                )}
              >
                <input
                  type="radio"
                  name="notes-share-role"
                  value={option}
                  checked={role === option}
                  onChange={() => { void update({ role: option }) }}
                  className="mt-1"
                  data-testid={`notes-share-role-${option}`}
                />
                <span className="flex flex-col">
                  <span className="text-sm">{t(ROLE_LABEL[option])}</span>
                  <span className="text-xs text-muted-foreground">{t(ROLE_HINT[option])}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {url ? (
            <div className="flex items-center gap-2" data-testid="notes-share-link">
              <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] bg-surface-hover px-2 py-1.5 text-xs">{url}</code>
              <Button variant="outline" size="sm" onClick={() => { void copy() }} aria-label={t('notes.share.copy')} data-testid="notes-share-copy">
                {copied ? <Check className="icon-toolbar" aria-hidden="true" /> : <Copy className="icon-toolbar" aria-hidden="true" />}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void update({ regenerate: true }) }} aria-label={t('notes.share.regenerate')} aria-describedby="notes-share-regenerate-hint" data-testid="notes-share-regenerate">
                <RefreshCw className="icon-toolbar" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('notes.share.disabledHint')}</p>
          )}

          {url && <p id="notes-share-regenerate-hint" className="text-xs text-muted-foreground">{t('notes.share.regenerateHint')}</p>}
          <p className="text-xs text-muted-foreground">{t('notes.share.localHint')}</p>
          {error && <p role="alert" className="text-xs text-destructive" data-testid="notes-share-error">{t('notes.share.error')}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('notes.share.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
