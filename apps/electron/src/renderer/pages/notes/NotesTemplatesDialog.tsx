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
import { reservedTemplateIdKind, sanitizeTemplateId, sanitizeTemplateIdDraft } from './note-library'

export function NotesTemplatesDialog({
  open,
  mode,
  templates,
  busy,
  defaultTitle,
  pendingReplaceId,
  onOpenChange,
  onCreateFromTemplate,
  onSaveAsTemplate,
  onPendingReplaceHandled,
}: {
  open: boolean
  mode: 'create' | 'save'
  templates: readonly NoteTemplateSummary[]
  busy?: boolean
  defaultTitle?: string
  /** When set (e.g. after server CONFLICT), show replace-confirm for this id. */
  pendingReplaceId?: string | null
  onOpenChange(open: boolean): void
  onCreateFromTemplate(templateId: string, title: string): void
  onSaveAsTemplate(templateId: string, title: string, confirmReplace?: boolean): void
  onPendingReplaceHandled?(): void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = React.useState<string>('')
  const [title, setTitle] = React.useState('')
  const [templateId, setTemplateId] = React.useState('')
  /** Once the user edits the id field, stop auto-deriving it from title. */
  const [templateIdDirty, setTemplateIdDirty] = React.useState(false)
  const [replaceConfirm, setReplaceConfirm] = React.useState(false)
  const wasOpenRef = React.useRef(false)

  React.useEffect(() => {
    const opened = open && !wasOpenRef.current
    wasOpenRef.current = open
    if (!open) return
    if (opened) {
      setTitle(defaultTitle ?? '')
      setTemplateId(sanitizeTemplateId(defaultTitle ?? 'template'))
      setTemplateIdDirty(false)
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

  React.useEffect(() => {
    if (!pendingReplaceId) return
    const id = sanitizeTemplateId(pendingReplaceId)
    if (!id) return
    setTemplateId(id)
    setTemplateIdDirty(true)
    setReplaceConfirm(true)
    onPendingReplaceHandled?.()
  }, [pendingReplaceId, onPendingReplaceHandled])

  const safeId = sanitizeTemplateId(templateId)
  const reservedKind = mode === 'save' ? reservedTemplateIdKind(safeId) : null
  const collision = mode === 'save' && safeId && !reservedKind ? templates.some((item) => item.id === safeId) : false

  const requestSave = (confirmReplace = false) => {
    if (!safeId || reservedKind) return
    if (collision && !confirmReplace) {
      setReplaceConfirm(true)
      return
    }
    onSaveAsTemplate(safeId, title.trim() || safeId, confirmReplace || undefined)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next && busy) return
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
                const nextTitle = event.target.value
                setTitle(nextTitle)
                if (!templateIdDirty) {
                  setTemplateId(sanitizeTemplateId(nextTitle || 'template'))
                }
                setReplaceConfirm(false)
              }}
              placeholder={t('notes.library.templateTitlePlaceholder')}
              data-testid="notes-template-title-save"
            />
            <Input
              value={templateId}
              onChange={(event) => {
                setTemplateIdDirty(true)
                setTemplateId(sanitizeTemplateIdDraft(event.target.value))
                setReplaceConfirm(false)
              }}
              onBlur={() => {
                setTemplateId((current) => sanitizeTemplateId(current))
              }}
              placeholder={t('notes.library.templateIdPlaceholder')}
              data-testid="notes-template-id"
            />
            {reservedKind ? (
              <p className="text-caption text-destructive" data-testid="notes-template-reserved" role="alert">
                {reservedKind === 'imports'
                  ? t('notes.library.templateIdReservedImports')
                  : t('notes.library.templateIdReservedDaily')}
              </p>
            ) : collision ? (
              <p className="text-caption text-status-warning" data-testid="notes-template-collision">
                {t('notes.library.templatesReplaceHint', { id: safeId })}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {replaceConfirm ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setReplaceConfirm(false)}>{t('notes.dialog.cancel')}</Button>
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
              <Button variant="outline" disabled={busy} onClick={() => { if (!busy) onOpenChange(false) }}>{t('notes.dialog.cancel')}</Button>
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
                  disabled={busy || !safeId || !!reservedKind}
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
