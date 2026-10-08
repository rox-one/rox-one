import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface QuickStartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickStartDialog({ open, onOpenChange }: QuickStartDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = React.useState('my-project')
  const [location, setLocation] = React.useState('~/Rox/projects')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="quick-start-dialog">
        <DialogHeader>
          <DialogTitle>{t('se.dialog.quickStartTitle')}</DialogTitle>
          <DialogDescription>{t('se.dialog.quickStartDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">{t('se.dialog.projectName')}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t('se.dialog.location')}</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => onOpenChange(false)}>{t('se.dialog.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
