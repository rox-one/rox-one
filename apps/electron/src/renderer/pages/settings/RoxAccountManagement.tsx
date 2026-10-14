/**
 * rox-id account management (top-50 items 44–46): handle@rox.one, per-user
 * inference key rotation, devices with revoke. Talks to the host over IPC; the
 * session token and the key never reach the renderer (prefix only).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { RoxIdSession } from '@rox/shared/auth'
import { SettingsCard, SettingsRow, SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/

type Load<T> = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ready'; value: T }

function errorKey(code: string): string {
  switch (code) {
    case 'ROX_HANDLE_TAKEN': return 'settings.account.rox.errors.handleTaken'
    case 'ROX_HANDLE_INVALID': return 'settings.account.rox.errors.handleInvalid'
    case 'ROX_AUTH_EXPIRED': return 'settings.account.rox.errors.expired'
    case 'ROX_AUTH_TEMPORARILY_UNAVAILABLE': return 'settings.account.rox.errors.unavailable'
    default: return 'settings.account.rox.errors.generic'
  }
}

export function useRoxSessions(enabled: boolean) {
  const [state, setState] = React.useState<Load<RoxIdSession[]>>({ kind: 'loading' })
  const reload = React.useCallback(async () => {
    if (!enabled) return
    setState({ kind: 'loading' })
    const res = await window.electronAPI.listRoxSessions().catch(() => ({ ok: false as const, error: 'ROX_AUTH_REQUEST_FAILED' }))
    setState(res.ok ? { kind: 'ready', value: res.sessions } : { kind: 'error', code: res.error })
  }, [enabled])
  React.useEffect(() => { void reload() }, [reload])
  return { state, reload }
}

export function RoxAccountManagement({ handle, keyPrefix }: { handle: string | null; keyPrefix: string | null }) {
  const { t, i18n } = useTranslation()
  const { state: sessions, reload } = useRoxSessions(true)
  const [handleDraft, setHandleDraft] = React.useState(handle ?? '')
  const [busy, setBusy] = React.useState<string | null>(null)
  const [prefix, setPrefix] = React.useState(keyPrefix)
  React.useEffect(() => { setPrefix(keyPrefix) }, [keyPrefix])
  React.useEffect(() => { setHandleDraft(handle ?? '') }, [handle])

  const draft = handleDraft.trim().toLowerCase()
  const handleValid = HANDLE_RE.test(draft)
  const fmt = React.useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.resolvedLanguage, i18n.language])
  const when = (iso: string | null) => { const at = iso ? Date.parse(iso) : NaN; return Number.isFinite(at) ? fmt.format(at) : '—' }

  const run = async (id: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    setBusy(id)
    try {
      const res = await action().catch(() => ({ ok: false as const, error: 'ROX_AUTH_REQUEST_FAILED' }))
      if (res.ok) toast.success(success)
      else toast.error(t(errorKey(res.error)))
      return res.ok
    } finally { setBusy(null) }
  }

  const claimHandle = () => void run('handle', async () => {
    const res = await window.electronAPI.setRoxHandle(draft)
    if (res.ok) setHandleDraft(res.handle)
    return res
  }, t('settings.account.rox.handleSaved', { address: `${draft}@rox.one` }))

  const rotate = () => {
    if (!window.confirm(t('settings.account.rox.rotateConfirm'))) return
    void run('rotate', async () => {
      const res = await window.electronAPI.rotateRoxKey()
      if (res.ok) setPrefix(res.prefix)
      return res
    }, t('settings.account.rox.rotated'))
  }

  const revoke = (s: RoxIdSession) => void run(`revoke-${s.id}`, () => window.electronAPI.revokeRoxSession(s.id), t('settings.account.rox.revoked')).then((ok) => { if (ok) void reload() })
  const revokeOthers = () => void run('revoke-others', () => window.electronAPI.revokeOtherRoxSessions(), t('settings.account.rox.revokedOthers')).then((ok) => { if (ok) void reload() })

  const others = sessions.kind === 'ready' ? sessions.value.filter((s) => !s.current).length : 0

  return (
    <>
      <SettingsSection title={t('settings.account.rox.addressSection')}>
        <SettingsCard>
          <SettingsRow label={t('settings.account.rox.handle')} description={t('settings.account.rox.handleHint')}>
            <div className="flex min-w-[260px] items-center gap-2">
              <Input
                value={handleDraft}
                onChange={(e) => setHandleDraft(e.target.value)}
                aria-label={t('settings.account.rox.handle')}
                aria-invalid={draft !== '' && !handleValid}
                className="h-8"
                maxLength={30}
                data-testid="rox-handle-input"
              />
              <span className="shrink-0 text-sm text-muted-foreground">@rox.one</span>
              <Button size="sm" variant="outline" disabled={!handleValid || draft === handle || busy !== null} onClick={claimHandle} data-testid="rox-handle-save">
                {t('settings.account.rox.handleSave')}
              </Button>
            </div>
          </SettingsRow>
          <SettingsRow label={t('settings.account.rox.key')} description={t('settings.account.rox.keyHint')}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm" data-testid="rox-key-prefix">{prefix ? `${prefix}…` : '—'}</span>
              <Button size="sm" variant="outline" disabled={busy !== null || !prefix} onClick={rotate} data-testid="rox-key-rotate">
                {t('settings.account.rox.rotate')}
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t('settings.account.rox.devicesSection')}>
        <SettingsCard>
          {sessions.kind === 'loading' ? (
            <SettingsRow label={t('settings.account.rox.devicesLoading')}><span role="status" className="text-sm text-muted-foreground">…</span></SettingsRow>
          ) : sessions.kind === 'error' ? (
            <SettingsRow label={t(errorKey(sessions.code))}>
              <Button size="sm" variant="outline" onClick={() => void reload()}>{t('common.retry')}</Button>
            </SettingsRow>
          ) : sessions.value.length === 0 ? (
            <SettingsRow label={t('settings.account.rox.devicesEmpty')}><span /></SettingsRow>
          ) : (
            sessions.value.map((s) => (
              <SettingsRow
                key={s.id}
                label={`${s.deviceName || t('settings.account.rox.unknownDevice')}${s.current ? ` · ${t('settings.account.rox.thisDevice')}` : ''}`}
                description={t('settings.account.rox.deviceMeta', { platform: s.platform ?? s.kind, seen: when(s.lastSeenAt ?? s.createdAt) })}
              >
                {s.current ? <span className="text-sm text-muted-foreground">{t('settings.account.rox.thisDevice')}</span> : (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => revoke(s)} data-testid="rox-session-revoke">
                    {t('settings.account.rox.revoke')}
                  </Button>
                )}
              </SettingsRow>
            ))
          )}
          {others > 0 ? (
            <SettingsRow label={t('settings.account.rox.revokeOthersLabel', { count: others })}>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={revokeOthers} data-testid="rox-session-revoke-others">
                {t('settings.account.rox.revokeOthers')}
              </Button>
            </SettingsRow>
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
