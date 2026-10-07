import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface WhatsNewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version?: string
}

export function WhatsNewSheet({ open, onOpenChange, version = '6.0' }: WhatsNewSheetProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="whats-new-sheet"
        className="fixed top-0 right-0 left-auto h-full max-h-none w-full max-w-md translate-x-0 translate-y-0 rounded-none border-l sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{t('se.whatsNew.title', { version })}</DialogTitle>
          <DialogDescription>{t('se.whatsNew.desc')}</DialogDescription>
        </DialogHeader>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>{t('se.whatsNew.item1')}</li>
          <li>{t('se.whatsNew.item2')}</li>
          <li>{t('se.whatsNew.item3')}</li>
        </ul>
      </DialogContent>
    </Dialog>
  )
}
