import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { NoteTemplateSummary } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sanitizeTemplateId } from './note-library'

export function NotesTemplatesDialog({
  open,
  mode,
  templates,
  busy,
  defaultTitle,
  onOpenChange,
  onCreateFromTemplate,
  onSaveAsTemplate,
}: {
  open: boolean
  mode: 'create' | 'save'
  templates: readonly NoteTemplateSummary[]
  busy?: boolean
  defaultTitle?: string
  onOpenChange(open: boolean): void
  onCreateFromTemplate(templateId: string, title: string): void
  onSaveAsTemplate(templateId: string, title: string): void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = React.useState<string>('')
  const [title, setTitle] = React.useState('')
  const [templateId, setTemplateId] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setTitle(defaultTitle ?? '')
    setTemplateId(sanitizeTemplateId(defaultTitle ?? 'template'))
    setSelectedId(templates[0]?.id ?? '')
  }, [open, defaultTitle, templates])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="notes-templates-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('notes.library.templatesCreateTitle') : t('notes.library.templatesSaveTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create' ? t('notes.library.templatesCreateDesc') : t('notes.library.templatesSaveDesc')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'create' ? (
          <div className="space-y-3">
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border/50 p-1">
              {templates.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">{t('notes.library.templatesEmpty')}</p>
              ) : templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover ${selectedId === template.id ? 'bg-surface-selected' : ''}`}
                  onClick={() => {
                    setSelectedId(template.id)
                    if (!title.trim()) setTitle(template.title)
                  }}
                >
                  <span className="truncate font-medium">{template.title}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{template.id}</span>
                </button>
              ))}
            </div>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('notes.dialog.noteTitlePlaceholder')}
              data-testid="notes-template-title"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setTemplateId(sanitizeTemplateId(event.target.value || 'template'))
              }}
              placeholder={t('notes.library.templateTitlePlaceholder')}
            />
            <Input
              value={templateId}
              onChange={(event) => setTemplateId(sanitizeTemplateId(event.target.value))}
              placeholder={t('notes.library.templateIdPlaceholder')}
              data-testid="notes-template-id"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('notes.dialog.cancel')}</Button>
          {mode === 'create' ? (
            <Button
              disabled={busy || !selectedId}
              data-testid="notes-template-create"
              onClick={() => onCreateFromTemplate(selectedId, title.trim())}
            >
              {t('notes.library.createFromTemplate')}
            </Button>
          ) : (
            <Button
              disabled={busy || !sanitizeTemplateId(templateId)}
              data-testid="notes-template-save"
              onClick={() => onSaveAsTemplate(sanitizeTemplateId(templateId), title.trim() || sanitizeTemplateId(templateId))}
            >
              {t('notes.library.saveAsTemplate')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
