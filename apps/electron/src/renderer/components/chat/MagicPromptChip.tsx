import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { improvePromptWithMeta } from '@craft-agent/shared/side-threads'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useRegisterModal } from '@/context/ModalContext'

export type MagicPromptChipProps = {
  draft: string
  onApply: (prompt: string) => void
}

export function MagicPromptChip({ draft, onApply }: MagicPromptChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [prompt, setPrompt] = React.useState('')
  useRegisterModal(open, () => setOpen(false))

  const handleOpen = () => {
    setPrompt(improvePromptWithMeta(draft))
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('sideThread.magicImprove')}
        title={t('sideThread.magicImprove')}
        disabled={!draft.trim()}
        onClick={handleOpen}
        className="flex h-6 items-center gap-1 rounded-[6px] border border-border/60 bg-background px-1.5 text-xs text-foreground/80 hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
      >
        <Sparkles className="h-3 w-3" />
        {t('sideThread.magic')}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
            <DialogTitle>{t('sideThread.magicImprove')}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 px-6 py-4">
            <label className="mb-2 block text-xs text-muted-foreground" htmlFor="magic-prompt">
              {t('sideThread.previewHint')}
            </label>
            <textarea
              id="magic-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-72 w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter className="shrink-0 border-t border-border/50 px-6 py-3">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(prompt)
                setOpen(false)
              }}
              disabled={!prompt.trim()}
            >
              {t('sideThread.applyPrompt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
