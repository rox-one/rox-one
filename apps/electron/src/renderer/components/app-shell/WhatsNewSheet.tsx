import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

export interface WhatsNewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  version?: string
}

export function WhatsNewSheet({ open, onOpenChange, version = '6.0' }: WhatsNewSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" data-testid="whats-new-sheet">
        <SheetHeader>
          <SheetTitle>{t('se.whatsNew.title', { version })}</SheetTitle>
          <SheetDescription>{t('se.whatsNew.desc')}</SheetDescription>
        </SheetHeader>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>{t('se.whatsNew.item1')}</li>
          <li>{t('se.whatsNew.item2')}</li>
          <li>{t('se.whatsNew.item3')}</li>
        </ul>
      </SheetContent>
    </Sheet>
  )
}
