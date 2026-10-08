/**
 * «Секреты» — one place for named secret references and the vault account they
 * resolve from. Left column: provider status + the configured refs. Right pane:
 * the account connection form. Secret values never reach this renderer — the
 * vault account is stored as a reference Connection only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InfisicalAccountPreview, SecretRefEntry } from '../../../../shared/types'
import { toErrorMessage } from '@/lib/errors'
import {
  Card,
  CardTitle,
  Chip,
  ScreenButton,
  ScreenColumn,
  ScreenDetail,
  ScreenHeader,
  ScreenRoot,
  SectionLabel,
  TextField,
} from '../ui'

type ProviderStatus = 'unknown' | 'checking' | 'connected' | 'disconnected'

type AccountForm = {
  siteUrl: string
  clientId: string
  clientSecret: string
  projectId: string
  environment: string
  secretPath: string
  secretKey: string
}

const EMPTY_FORM: AccountForm = {
  siteUrl: 'https://app.infisical.com',
  clientId: '',
  clientSecret: '',
  projectId: '',
  environment: '',
  secretPath: '/',
  secretKey: '',
}

const PROVIDER_PROBE_ERROR_CODES = ['tls', 'auth', 'tenant', 'secret_missing'] as const

function accountErrorKey(message: string): string {
  const code = PROVIDER_PROBE_ERROR_CODES.find((candidate) => message.includes(candidate))
  return code ? `extraScreens.secrets.error.${code}` : 'extraScreens.secrets.error.generic'
}

export default function SecretsPage(_props: { itemId: string | null }) {
  const { t } = useTranslation()
  const [refs, setRefs] = useState<SecretRefEntry[] | null>(null)
  const [refsError, setRefsError] = useState(false)
  const [provider, setProvider] = useState<ProviderStatus>('unknown')
  const [providerId, setProviderId] = useState<string | null>(null)
  const [form, setForm] = useState<AccountForm>(EMPTY_FORM)
  const [preview, setPreview] = useState<InfisicalAccountPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  const loadRefs = useCallback(() => {
    window.electronAPI
      .getSecretRefs()
      .then((payload) => {
        setRefs(payload.refs)
        setProvider(payload.infisical.available ? 'connected' : 'disconnected')
      })
      .catch((error) => {
        console.error('Failed to load secret refs:', error)
        setRefs([])
        setRefsError(true)
      })
  }, [])

  const checkProvider = useCallback(async () => {
    setProvider('checking')
    try {
      const health = await window.electronAPI.fabricInfisicalHealth()
      setProvider(health.available ? 'connected' : 'disconnected')
      setProviderId(health.providerId ?? null)
    } catch {
      setProvider('disconnected')
    }
  }, [])

  useEffect(() => {
    loadRefs()
    void checkProvider()
  }, [loadRefs, checkProvider])

  const field = (key: keyof AccountForm) => (value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setPreview(null)
    setConnected(false)
  }

  const runPreview = useCallback(async () => {
    setPreviewing(true)
    setAccountError(null)
    try {
      const result = await window.electronAPI.fabricInfisicalPreviewAccount({
        siteUrl: form.siteUrl,
        clientId: form.clientId,
        projectId: form.projectId,
        environment: form.environment,
        secretPath: form.secretPath,
        secretKey: form.secretKey,
      })
      setPreview(result)
    } catch (error) {
      setPreview(null)
      setAccountError(t(accountErrorKey(toErrorMessage(error))))
    } finally {
      setPreviewing(false)
    }
  }, [form, t])

  const commit = useCallback(async () => {
    if (!preview) {
      setAccountError(t('extraScreens.secrets.error.previewRequired'))
      return
    }
    setConnecting(true)
    setAccountError(null)
    try {
      await window.electronAPI.fabricInfisicalCommitImport({
        siteUrl: form.siteUrl,
        clientId: form.clientId,
        clientSecret: form.clientSecret,
        projectId: form.projectId,
        environment: form.environment,
        secretPath: form.secretPath,
        secretKey: form.secretKey,
      })
      setConnected(true)
      setPreview(null)
      setForm((current) => ({ ...current, clientSecret: '' }))
      await checkProvider()
      loadRefs()
    } catch (error) {
      setAccountError(t(accountErrorKey(toErrorMessage(error))))
    } finally {
      setConnecting(false)
    }
  }, [preview, form, t, checkProvider, loadRefs])

  const statusKey = useMemo(() => {
    if (provider === 'connected') return 'extraScreens.secrets.providerConnected'
    if (provider === 'checking') return 'extraScreens.secrets.providerChecking'
    return 'extraScreens.secrets.providerDisconnected'
  }, [provider])

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(240px, 32%, 340px)">
        <ScreenHeader
          title={t('extraScreens.secrets.title')}
          actions={
            <ScreenButton variant="ghost" onClick={() => { loadRefs(); void checkProvider() }}>
              {t('extraScreens.secrets.refresh')}
            </ScreenButton>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <SectionLabel>{t('extraScreens.secrets.providerTitle')}</SectionLabel>
          <div className="flex items-center gap-2 pb-3">
            <Chip tone={provider === 'connected' ? 'ok' : provider === 'checking' ? 'neutral' : 'warn'}>
              {t(statusKey)}
            </Chip>
            {providerId && <span className="text-small text-muted-foreground">{providerId}</span>}
          </div>

          <SectionLabel>
            {t('extraScreens.secrets.refsTitle')}
            {refs ? ` · ${refs.length}` : ''}
          </SectionLabel>
          {refs === null && <div className="text-muted-foreground">{t('common.loading')}</div>}
          {refsError && <div className="text-destructive">{t('extraScreens.secrets.error.load')}</div>}
          {refs && refs.length === 0 && (
            <div className="text-muted-foreground">{t('extraScreens.secrets.refsEmpty')}</div>
          )}
          {refs && refs.map((ref) => (
            <div key={`${ref.name}:${ref.envVar}`} className="rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-hover">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-small">{ref.name}</span>
                <span className="shrink-0 truncate font-mono text-small text-muted-foreground">{ref.envVar}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-small text-muted-foreground">
                <span>{t('extraScreens.secrets.refProvider')}: {ref.provider ?? t('extraScreens.secrets.refAny')}</span>
                {ref.ref && <span className="min-w-0 truncate font-mono">{ref.ref}</span>}
              </div>
            </div>
          ))}
          {refs && refs.length === 0 && (
            <div className="pt-1 text-small text-muted-foreground">{t('extraScreens.secrets.refsEmptyHint')}</div>
          )}
        </div>
      </ScreenColumn>

      <ScreenDetail className="overflow-x-hidden">
        <div className="min-w-0 max-w-[720px]">
          <Card>
            <CardTitle>{t('extraScreens.secrets.connectTitle')}</CardTitle>
            <p className="mt-1 text-small text-muted-foreground">{t('extraScreens.secrets.connectHint')}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.siteUrl')}
                <TextField value={form.siteUrl} onChange={field('siteUrl')} placeholder="https://app.infisical.com" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.projectId')}
                <TextField value={form.projectId} onChange={field('projectId')} placeholder="project-id" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.clientId')}
                <TextField value={form.clientId} onChange={field('clientId')} placeholder="client-id" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.clientSecret')}
                <TextField value={form.clientSecret} onChange={field('clientSecret')} placeholder="••••••••" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.environment')}
                <TextField value={form.environment} onChange={field('environment')} placeholder="prod" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.secretPath')}
                <TextField value={form.secretPath} onChange={field('secretPath')} placeholder="/" />
              </label>
              <label className="flex flex-col gap-1 text-small">
                {t('extraScreens.secrets.field.secretKey')}
                <TextField value={form.secretKey} onChange={field('secretKey')} placeholder="SECRET_KEY" />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ScreenButton onClick={() => void runPreview()} disabled={previewing || connecting}>
                {previewing ? t('extraScreens.secrets.checking') : t('extraScreens.secrets.check')}
              </ScreenButton>
              <ScreenButton variant="primary" onClick={() => void commit()} disabled={!preview || connecting}>
                {connecting ? t('extraScreens.secrets.connecting') : t('extraScreens.secrets.connect')}
              </ScreenButton>
            </div>

            {preview && (
              <div className="mt-2 text-small text-success">
                {t('extraScreens.secrets.previewOk', {
                  label: preview.label,
                  project: preview.projectId,
                  environment: preview.environment,
                })}
              </div>
            )}
            {connected && (
              <div className="mt-2 text-small text-success">{t('extraScreens.secrets.connectDone')}</div>
            )}
            {accountError && <div className="mt-2 text-small text-destructive" role="alert">{accountError}</div>}
          </Card>
        </div>
      </ScreenDetail>
    </ScreenRoot>
  )
}