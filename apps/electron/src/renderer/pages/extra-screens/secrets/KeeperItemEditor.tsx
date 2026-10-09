/**
 * ROX Keeper — item editor (right pane). Pure controlled component: it renders
 * one `KeeperDraft` and reports field changes / save / delete upward. All vault
 * I/O stays in `KeeperItemsPane`.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardTitle, Chip, ScreenButton, SectionLabel, TextArea, TextField } from '../ui'
import {
  KEEPER_ITEM_TYPES,
  shareStateKey,
  type KeeperDraft,
  type KeeperIssue,
  type KeeperItemType,
} from './keeper-model'

export interface KeeperItemEditorProps {
  draft: KeeperDraft
  issues: readonly KeeperIssue[]
  saving: boolean
  deleting: boolean
  /** true for an item that has never been saved (delete is unavailable). */
  isNew: boolean
  /** Transport/validation error surfaced above the actions. */
  error: string | null
  onChange: (patch: Partial<KeeperDraft>) => void
  onSave: () => void
  onDelete: () => void
}

const TYPE_LABEL_KEYS: Record<KeeperItemType, string> = {
  login: 'extraScreens.keeper.type.login',
  note: 'extraScreens.keeper.type.note',
  card: 'extraScreens.keeper.type.card',
  identity: 'extraScreens.keeper.type.identity',
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-small text-muted-foreground">{children}</span>
}

export function KeeperItemEditor({
  draft,
  issues,
  saving,
  deleting,
  isNew,
  error,
  onChange,
  onSave,
  onDelete,
}: KeeperItemEditorProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Fresh item selection resets transient editor chrome.
  useEffect(() => {
    setRevealed(false)
    setCopied(false)
    setConfirmDelete(false)
  }, [draft.key, draft.path, isNew])

  const issueKeys = new Set(issues.map((issue) => issue.key))
  const busy = saving || deleting
  const readOnly = draft.raw

  const copyPassword = async (): Promise<void> => {
    if (draft.password === '') return
    try {
      await navigator.clipboard?.writeText(draft.password)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be unavailable (headless/denied); copying is not critical.
    }
  }

  return (
    <div className="min-w-0 max-w-[720px]">
      <Card>
        <div className="flex items-center gap-2">
          <CardTitle>{t(isNew ? 'extraScreens.keeper.newItem' : 'extraScreens.keeper.editItem')}</CardTitle>
          <span className="flex-1" />
          {readOnly ? (
            <Chip tone="warn">{t('extraScreens.keeper.rawBadge')}</Chip>
          ) : (
            <Chip tone={draft.shared ? 'ok' : 'neutral'}>{t(shareStateKey(draft.shared))}</Chip>
          )}
        </div>
        {draft.key && (
          <div className="mt-1 font-mono text-small text-muted-foreground">
            {t('extraScreens.keeper.field.key')}: {draft.key}
          </div>
        )}

        {readOnly && (
          <div className="mt-3">
            <div className="font-semibold text-warning">{t('extraScreens.keeper.rawItem')}</div>
            <div className="mt-0.5 text-small text-muted-foreground">{t('extraScreens.keeper.rawItemHint')}</div>
          </div>
        )}

        {!readOnly && (
          <div className="mt-3">
            <SectionLabel>{t('extraScreens.keeper.field.type')}</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {KEEPER_ITEM_TYPES.map((type) => (
                <Chip key={type} active={draft.type === type} onClick={() => onChange({ type })}>
                  {t(TYPE_LABEL_KEYS[type])}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {!readOnly && (
          <div className="mt-3 grid gap-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.title')}</FieldLabel>
            <TextField
              value={draft.title}
              onChange={(title) => onChange({ title })}
              placeholder={t('extraScreens.keeper.field.title')}
              ariaLabel={t('extraScreens.keeper.field.title')}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.username')}</FieldLabel>
            <TextField
              value={draft.username}
              onChange={(username) => onChange({ username })}
              ariaLabel={t('extraScreens.keeper.field.username')}
            />
          </label>

          <div className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.password')}</FieldLabel>
            <div className="flex items-center gap-1.5">
              <input
                type={revealed ? 'text' : 'password'}
                value={draft.password}
                spellCheck={false}
                autoComplete="off"
                aria-label={t('extraScreens.keeper.field.password')}
                onChange={(event) => onChange({ password: event.target.value })}
                className="h-8 w-full min-w-0 rounded-[var(--radius-card)] bg-surface-hover px-2.5 font-mono text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
              />
              <ScreenButton variant="ghost" onClick={() => setRevealed((value) => !value)}>
                {t(revealed ? 'extraScreens.keeper.hide' : 'extraScreens.keeper.show')}
              </ScreenButton>
              <ScreenButton variant="ghost" onClick={() => void copyPassword()} disabled={draft.password === ''}>
                {t(copied ? 'extraScreens.keeper.copied' : 'extraScreens.keeper.copy')}
              </ScreenButton>
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.url')}</FieldLabel>
            <TextField
              value={draft.url}
              onChange={(url) => onChange({ url })}
              placeholder="https://"
              ariaLabel={t('extraScreens.keeper.field.url')}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.totp')}</FieldLabel>
            <TextField
              value={draft.totp}
              onChange={(totp) => onChange({ totp })}
              placeholder="JBSWY3DPEHPK3PXP"
              ariaLabel={t('extraScreens.keeper.field.totp')}
            />
          </label>

          <label className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.tags')}</FieldLabel>
            <TextField
              value={draft.tagsText}
              onChange={(tagsText) => onChange({ tagsText })}
              placeholder={t('extraScreens.keeper.field.tagsHint')}
              ariaLabel={t('extraScreens.keeper.field.tags')}
            />
          </label>

          <div className="flex flex-col gap-1">
            <FieldLabel>{t('extraScreens.keeper.field.notes')}</FieldLabel>
            <TextArea
              value={draft.notes}
              onChange={(notes) => onChange({ notes })}
              ariaLabel={t('extraScreens.keeper.field.notes')}
            />
          </div>
          </div>
        )}

        {!readOnly && (
          <div className="mt-3 flex items-start gap-2">
            <Chip active={draft.shared} onClick={() => onChange({ shared: !draft.shared })}>
              {t('extraScreens.keeper.shareToggle')}
            </Chip>
            <span className="pt-0.5 text-small text-muted-foreground">{t('extraScreens.keeper.shareHint')}</span>
          </div>
        )}

        {issueKeys.size > 0 && (
          <ul className="mt-2 text-small text-destructive" role="alert">
            {[...issueKeys].map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        )}
        {error && <div className="mt-2 text-small text-destructive" role="alert">{error}</div>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!readOnly && (
            <ScreenButton variant="primary" onClick={onSave} disabled={busy}>
              {t(saving ? 'extraScreens.keeper.saving' : 'extraScreens.keeper.save')}
            </ScreenButton>
          )}
          {!isNew && !confirmDelete && (
            <ScreenButton variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
              {t('extraScreens.keeper.delete')}
            </ScreenButton>
          )}
          {!isNew && confirmDelete && (
            <>
              <ScreenButton variant="danger" onClick={onDelete} disabled={busy}>
                {t(deleting ? 'extraScreens.keeper.deleting' : 'extraScreens.keeper.confirmDelete')}
              </ScreenButton>
              <ScreenButton variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                {t('extraScreens.keeper.cancel')}
              </ScreenButton>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}