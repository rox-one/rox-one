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

export interface CloneFromUrlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CloneFromUrlDialog({ open, onOpenChange }: CloneFromUrlDialogProps) {
  const { t } = useTranslation()
  const [url, setUrl] = React.useState('https://github.com/org/repo.git')
  const [location, setLocation] = React.useState('~/super.engineering/projects')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="clone-url-dialog">
        <DialogHeader>
          <DialogTitle>{t('se.dialog.cloneTitle')}</DialogTitle>
          <DialogDescription>{t('se.dialog.cloneDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm">
            <span className="text-muted-foreground">{t('se.dialog.repoUrl')}</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t('se.dialog.location')}</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => onOpenChange(false)}>{t('se.dialog.clone')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
