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
  onSaveAsTemplate(templateId: string, title: string, confirmReplace?: boolean): void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = React.useState<string>('')
  const [title, setTitle] = React.useState('')
  const [templateId, setTemplateId] = React.useState('')
  const [replaceConfirm, setReplaceConfirm] = React.useState(false)
  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    const opened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!open) return
    if (opened) {
      setTitle(defaultTitle ?? '')
      setTemplateId(sanitizeTemplateId(defaultTitle ?? 'template'))
      setSelectedId(templates[0]?.id ?? '')
      setReplaceConfirm(false)
      return
    }
    // Templates list refreshed while dialog stays open: keep typed fields,
    // only heal selectedId if it vanished or was empty.
    setSelectedId((current) => {
      if (current && templates.some((item) => item.id === current)) return current
      return templates[0]?.id ?? ''
    })
  }, [open, defaultTitle, templates])

  const safeId = sanitizeTemplateId(templateId)
  const collision = mode === 'save' && safeId ? templates.some((item) => item.id === safeId) : false

  const requestSave = (confirmReplace = false) => {
    if (!safeId) return
    if (collision && !confirmReplace) {
      setReplaceConfirm(true)
      return
    }
    onSaveAsTemplate(safeId, title.trim() || safeId, confirmReplace || undefined)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) setReplaceConfirm(false)
      onOpenChange(next)
    }}>
      <DialogContent data-testid="notes-templates-dialog">
        <DialogHeader>
          <DialogTitle>
            {replaceConfirm
              ? t('notes.library.templatesReplaceTitle')
              : mode === 'create'
                ? t('notes.library.templatesCreateTitle')
                : t('notes.library.templatesSaveTitle')}
          </DialogTitle>
          <DialogDescription>
            {replaceConfirm
              ? t('notes.library.templatesReplaceDesc', { id: safeId })
              : mode === 'create'
                ? t('notes.library.templatesCreateDesc')
                : t('notes.library.templatesSaveDesc')}
          </DialogDescription>
        </DialogHeader>

        {replaceConfirm ? null : mode === 'create' ? (
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
                setReplaceConfirm(false)
              }}
              placeholder={t('notes.library.templateTitlePlaceholder')}
            />
            <Input
              value={templateId}
              onChange={(event) => {
                setTemplateId(sanitizeTemplateId(event.target.value))
                setReplaceConfirm(false)
              }}
              placeholder={t('notes.library.templateIdPlaceholder')}
              data-testid="notes-template-id"
            />
            {collision ? (
              <p className="text-caption text-status-warning" data-testid="notes-template-collision">
                {t('notes.library.templatesReplaceHint', { id: safeId })}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {replaceConfirm ? (
            <>
              <Button variant="outline" onClick={() => setReplaceConfirm(false)}>{t('notes.dialog.cancel')}</Button>
              <Button
                disabled={busy}
                data-testid="notes-template-replace"
                onClick={() => requestSave(true)}
              >
                {t('notes.library.replaceTemplate')}
              </Button>
            </>
          ) : (
            <>
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
                  disabled={busy || !safeId}
                  data-testid="notes-template-save"
                  onClick={() => requestSave(false)}
                >
                  {t('notes.library.saveAsTemplate')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
