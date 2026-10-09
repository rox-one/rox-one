import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type AddRepositorySource = { kind: 'git-url'; url: string } | { kind: 'local-folder'; path: string }
type AddMode = AddRepositorySource['kind']

export interface AddRepositoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitting: boolean
  errorKey: string | null
  offline: boolean
  onSubmit: (source: AddRepositorySource) => void
}

// D3: only https GitHub links are accepted by the ingest contour.
const GITHUB_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/

/** С-02 source step (§B.2): link or local folder, no consent emulation. */
export function AddRepositoryDialog({ open, onOpenChange, submitting, errorKey, offline, onSubmit }: AddRepositoryDialogProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<AddMode>('git-url')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')

  useEffect(() => { if (!open) { setUrl(''); setPath(''); setMode('git-url') } }, [open])

  const urlValid = GITHUB_URL.test(url.trim())
  const valid = mode === 'git-url' ? urlValid : path.trim().length > 0
  const chooseFolder = async () => {
    const picked = await window.electronAPI.openFolderDialog().catch(() => null)
    if (picked) setPath(picked)
  }
  const submit = () => {
    if (!valid || submitting) return
    onSubmit(mode === 'git-url' ? { kind: 'git-url', url: url.trim() } : { kind: 'local-folder', path: path.trim() })
  }
  const modeButton = (value: AddMode, labelKey: string, Icon: typeof Link2) => (
    <button
      type="button"
      aria-pressed={mode === value}
      data-testid={`dev-space-add-mode-${value}`}
      onClick={() => setMode(value)}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-ring',
        mode === value ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-subtle text-text-secondary hover:bg-surface-hover',
      )}
    >
      <Icon className="icon-caption" aria-hidden />{t(labelKey)}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dev-space-add-dialog">
        <DialogHeader>
          <DialogTitle>{t('devSpace.add.title')}</DialogTitle>
          <DialogDescription>{t('devSpace.add.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2" role="group" aria-label={t('devSpace.add.title')}>
            {modeButton('git-url', 'devSpace.add.modeUrl', Link2)}
            {modeButton('local-folder', 'devSpace.add.modeFolder', FolderOpen)}
          </div>
          {mode === 'git-url' ? (
            <label className="block space-y-1.5 text-xs font-medium">
              <span>{t('devSpace.add.urlLabel')}</span>
              <Input
                autoFocus
                data-testid="dev-space-add-url"
                value={url}
                disabled={submitting}
                placeholder={t('devSpace.add.urlPlaceholder')}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
              />
              {url.trim().length > 0 && !urlValid ? <span className="block text-destructive">{t('devSpace.add.invalidUrl')}</span> : null}
            </label>
          ) : (
            <div className="space-y-1.5 text-xs font-medium">
              <span className="block">{t('devSpace.add.folderLabel')}</span>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={submitting} data-testid="dev-space-add-folder" onClick={() => void chooseFolder()}>
                  <FolderOpen className="icon-caption" aria-hidden />{t('devSpace.add.chooseFolder')}
                </Button>
                <span className="min-w-0 flex-1 truncate font-mono text-text-secondary" data-testid="dev-space-add-path">
                  {path || t('devSpace.add.noFolder')}
                </span>
              </div>
            </div>
          )}
          {offline ? <p className="text-xs text-muted-foreground" role="status">{t('devSpace.add.offline')}</p> : null}
          {errorKey ? <p className="text-sm text-destructive" role="alert">{t(errorKey)}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{t('devSpace.add.cancel')}</Button>
          <Button type="button" disabled={!valid || submitting || (offline && mode === 'git-url')} data-testid="dev-space-add-submit" onClick={submit}>{t('devSpace.add.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}