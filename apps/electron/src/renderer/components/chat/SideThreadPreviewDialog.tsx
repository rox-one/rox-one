import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SideThreadAction } from '@craft-agent/shared/side-threads'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRegisterModal } from '@/context/ModalContext'

export type SideThreadPreview = {
  action: SideThreadAction
  messageId: string
  prompt: string
}

export type SideThreadPreviewDialogProps = {
  draft: SideThreadPreview | null
  onChangePrompt: (prompt: string) => void
  onCancel: () => void
  onConfirm: () => void
  busy?: boolean
}

export function SideThreadPreviewDialog({
  draft,
  onChangePrompt,
  onCancel,
  onConfirm,
  busy = false,
}: SideThreadPreviewDialogProps) {
  const { t } = useTranslation()
  useRegisterModal(!!draft, onCancel)

  return (
    <Dialog open={!!draft} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
          <DialogTitle>
            {draft ? t(`sideThread.action.${draft.action}`) : t('sideThread.previewTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 px-6 py-4">
          <label className="mb-2 block text-xs text-muted-foreground" htmlFor="side-thread-prompt">
            {t('sideThread.previewHint')}
          </label>
          <textarea
            id="side-thread-prompt"
            value={draft?.prompt ?? ''}
            onChange={(event) => onChangePrompt(event.target.value)}
            className="h-72 w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
          />
        </div>
        <DialogFooter className="shrink-0 border-t border-border/50 px-6 py-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy || !draft?.prompt.trim()}>
            {t('sideThread.openThread')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
