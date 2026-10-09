/**
 * Create / edit dialog for one vault item. On edit, blank secret fields mean
 * "keep the stored value"; explicit «remove» checkboxes clear them.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeeperItemInput, KeeperItemKind, KeeperItemView } from '../../../../shared/types'
import { Chip, ScreenButton, TextArea, TextField } from '../ui'
import { generatePassword, KEEPER_KIND_OPTIONS } from './vault-model'

export interface VaultDialogSubmit {
  input: KeeperItemInput
  clearPassword: boolean
  clearTotpSecret: boolean
}

interface FormState {
  kind: KeeperItemKind
  title: string
  username: string
  password: string
  url: string
  notes: string
  tags: string
  folders: string
  totpSecret: string
  expiresAt: string
  favorite: boolean
  clearPassword: boolean
  clearTotpSecret: boolean
}

function initialForm(initial: KeeperItemView | null): FormState {
  return {
    kind: initial?.kind ?? 'login',
    title: initial?.title ?? '',
    username: initial?.username ?? '',
    password: '',
    url: initial?.url ?? '',
    notes: initial?.notes ?? '',
    tags: (initial?.tags ?? []).join(', '),
    folders: (initial?.folders ?? []).join(', '),
    totpSecret: '',
    expiresAt: initial?.expiresAt ? new Date(initial.expiresAt).toISOString().slice(0, 10) : '',
    favorite: initial?.favorite ?? false,
    clearPassword: false,
    clearTotpSecret: false,
  }
}

function parseList(value: string): string[] {
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
}

export function VaultItemDialog({
  open,
  initial,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean
  initial: KeeperItemView | null
  busy: boolean
  onSubmit: (submit: VaultDialogSubmit) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => initialForm(initial))

  useEffect(() => {
    if (open) setForm(initialForm(initial))
  }, [open, initial])

  const editing = initial !== null
  const titleError = useMemo(() => form.title.trim().length === 0, [form.title])

  if (!open) return null

  const patch = (changes: Partial<FormState>) => setForm((current) => ({ ...current, ...changes }))

  const submit = () => {
    if (titleError || busy) return
    const expiresAt = form.expiresAt ? new Date(`${form.expiresAt}T00:00:00`).getTime() : undefined
    const input: KeeperItemInput = {
      kind: form.kind,
      title: form.title.trim(),
      tags: parseList(form.tags),
      folders: parseList(form.folders),
      ...(form.username.trim() ? { username: form.username.trim() } : {}),
      ...(form.password ? { password: form.password } : {}),
      ...(form.url.trim() ? { url: form.url.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes } : {}),
      ...(form.totpSecret.trim() ? { totpSecret: form.totpSecret.trim() } : {}),
      ...(form.favorite ? { favorite: true } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    }
    onSubmit({ input, clearPassword: form.clearPassword, clearTotpSecret: form.clearTotpSecret })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-full w-full max-w-[560px] overflow-y-auto rounded-[var(--radius-card)] bg-background p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[16px] font-bold">
            {editing ? t('extraScreens.secrets.vault.dialogEditTitle') : t('extraScreens.secrets.vault.dialogCreateTitle')}
          </h2>
          <ScreenButton variant="ghost" onClick={onClose}>{t('common.cancel')}</ScreenButton>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {KEEPER_KIND_OPTIONS.map((kind) => (
            <Chip key={kind} active={form.kind === kind} onClick={() => patch({ kind })}>
              {t(`extraScreens.secrets.vault.kind.${kind}`)}
            </Chip>
          ))}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-small sm:col-span-2">
            {t('extraScreens.secrets.vault.field.title')}
            <TextField value={form.title} onChange={(title) => patch({ title })} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('extraScreens.secrets.vault.field.username')}
            <TextField value={form.username} onChange={(username) => patch({ username })} />
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('extraScreens.secrets.vault.field.url')}
            <TextField value={form.url} onChange={(url) => patch({ url })} placeholder="https://" />
          </label>
          <label className="flex flex-col gap-1 text-small sm:col-span-2">
            {t('extraScreens.secrets.vault.field.password')}
            <span className="flex items-center gap-2">
              <TextField
                value={form.password}
                onChange={(password) => patch({ password, clearPassword: false })}
                placeholder={editing ? t('extraScreens.secrets.vault.keepSecret') : ''}
              />
              <ScreenButton onClick={() => patch({ password: generatePassword(), clearPassword: false })}>
                {t('extraScreens.secrets.vault.generate')}
              </ScreenButton>
              {editing && initial?.hasPassword && (
                <ScreenButton variant="ghost" onClick={() => patch({ password: '', clearPassword: !form.clearPassword })}>
                  {form.clearPassword ? t('extraScreens.secrets.vault.keepSecret') : t('extraScreens.secrets.vault.clearSecret')}
                </ScreenButton>
              )}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-small sm:col-span-2">
            {t('extraScreens.secrets.vault.field.totp')}
            <span className="flex items-center gap-2">
              <TextField
                value={form.totpSecret}
                onChange={(totpSecret) => patch({ totpSecret, clearTotpSecret: false })}
                placeholder={editing ? t('extraScreens.secrets.vault.keepSecret') : 'BASE32SECRET'}
              />
              {editing && initial?.hasTotpSecret && (
                <ScreenButton variant="ghost" onClick={() => patch({ totpSecret: '', clearTotpSecret: !form.clearTotpSecret })}>
                  {form.clearTotpSecret ? t('extraScreens.secrets.vault.keepSecret') : t('extraScreens.secrets.vault.clearSecret')}
                </ScreenButton>
              )}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('extraScreens.secrets.vault.field.tags')}
            <TextField value={form.tags} onChange={(tags) => patch({ tags })} placeholder="tag1, tag2" />
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('extraScreens.secrets.vault.field.folders')}
            <TextField value={form.folders} onChange={(folders) => patch({ folders })} placeholder="Работа, Личное" />
          </label>
          <label className="flex flex-col gap-1 text-small">
            {t('extraScreens.secrets.vault.field.expiresAt')}
            <TextField value={form.expiresAt} onChange={(expiresAt) => patch({ expiresAt })} placeholder="2026-12-31" />
          </label>
          <label className="mt-1 flex items-center gap-2 text-small">
            <input type="checkbox" checked={form.favorite} onChange={(event) => patch({ favorite: event.target.checked })} />
            {t('extraScreens.secrets.vault.favorite')}
          </label>
          <label className="flex flex-col gap-1 text-small sm:col-span-2">
            {t('extraScreens.secrets.vault.field.notes')}
            <TextArea value={form.notes} onChange={(notes) => patch({ notes })} rows={3} />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <ScreenButton variant="primary" onClick={submit} disabled={titleError || busy}>
            {busy ? t('common.saving') : t('extraScreens.secrets.vault.save')}
          </ScreenButton>
          <ScreenButton variant="ghost" onClick={onClose}>{t('common.cancel')}</ScreenButton>
          {titleError && <span className="text-small text-destructive">{t('extraScreens.secrets.vault.titleRequired')}</span>}
        </div>
      </div>
    </div>
  )
}