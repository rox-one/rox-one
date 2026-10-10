/**
 * «Секреты» — ROX Keeper.
 *
 * Two sections behind one surface: «Хранилище» (the local personal vault:
 * folders, search, CRUD, reveal/copy, TOTP) and «Провайдер» (the Rox Keeper
 * account + named refs, unchanged). Secret values never live in this renderer:
 * the list payload is masked and a value appears only after an explicit reveal,
 * which the surface auto-hides after 30 s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  InfisicalAccountPreview,
  KeeperItemView,
  KeeperUnlockStatus,
  KeeperVaultSnapshot,
  SecretRefEntry,
} from '../../../../shared/types'
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
import { VaultPanel } from './VaultPanel'
import { VaultItemDetail } from './VaultItemDetail'
import { VaultItemDialog, type VaultDialogSubmit } from './VaultItemDialog'
import { KeeperItemsPane, resolveKeeperVaultRpc, type KeeperScope } from './KeeperItemsPane'
import { deriveItemKey, isKeeperItemType, type KeeperItemValue } from './keeper-model'
import type { VaultFilter } from './vault-model'

type Section = 'personal' | 'organization'
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

const REVEAL_TIMEOUT_MS = 30_000
const PROVIDER_PROBE_ERROR_CODES = ['tls', 'auth', 'tenant', 'secret_missing'] as const

function accountErrorKey(message: string): string {
  const code = PROVIDER_PROBE_ERROR_CODES.find((candidate) => message.includes(candidate))
  return code ? `extraScreens.secrets.error.${code}` : 'extraScreens.secrets.error.generic'
}

export default function SecretsPage(_props: { itemId: string | null }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('personal')

  // --- Vault state -----------------------------------------------------
  const [snapshot, setSnapshot] = useState<KeeperVaultSnapshot | null>(null)
  const [unlock, setUnlock] = useState<KeeperUnlockStatus | null>(null)
  const [vaultError, setVaultError] = useState<string | null>(null)
  const [filter, setFilter] = useState<VaultFilter>({ folder: null, search: '', favoritesOnly: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ open: boolean; initial: KeeperItemView | null }>({ open: false, initial: null })
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<{ id: string; field: 'password' | 'totpSecret'; value: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const revealTimer = useRef<number | null>(null)

  // --- Provider (Rox Keeper) state ------------------------------------
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

  const loadVault = useCallback(async () => {
    try {
      const [status, vault] = await Promise.all([
        window.electronAPI.keeperUnlockStatus(),
        window.electronAPI.keeperList().catch((error: unknown) => {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'keeper-vault-locked') return null
          throw error
        }),
      ])
      setUnlock(status)
      if (vault) {
        setSnapshot(vault)
        setVaultError(null)
      } else {
        setSnapshot({ items: [], folders: [] })
      }
    } catch (error) {
      setSnapshot({ items: [], folders: [] })
      setVaultError(toErrorMessage(error))
    }
  }, [])

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
    void loadVault()
    loadRefs()
    void checkProvider()
  }, [loadVault, loadRefs, checkProvider])

  // Reveal grants are single-shot and time-boxed: clear after 30 s.
  useEffect(() => {
    if (!reveal) return
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    revealTimer.current = window.setTimeout(() => setReveal(null), REVEAL_TIMEOUT_MS)
    return () => {
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current)
    }
  }, [reveal])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const selection = useMemo(() => {
    if (!snapshot || !selectedId) return null
    return snapshot.items.find((item) => item.id === selectedId) ?? null
  }, [snapshot, selectedId])

  const refreshSelection = useCallback(async (id: string) => {
    try {
      const item = await window.electronAPI.keeperGet(id)
      setSnapshot((current) => {
        if (!current) return current
        return { ...current, items: current.items.map((entry) => (entry.id === id ? item : entry)) }
      })
    } catch {
      await loadVault()
    }
  }, [loadVault])

  const copyText = useCallback(async (value: string) => {
    try {
      await window.electronAPI.copyVoiceText({ text: value })
      setToast(t('extraScreens.secrets.vault.copied'))
    } catch {
      setToast(t('extraScreens.secrets.vault.copyFailed'))
    }
  }, [t])

  const revealSecret = useCallback(async (id: string, field: 'password' | 'totpSecret', show: boolean) => {
    setBusy(true)
    try {
      const result = await window.electronAPI.keeperReveal({ id, field })
      if (show) setReveal({ id, field, value: result.value })
      return result.value
    } catch (error) {
      setVaultError(toErrorMessage(error))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const handleToggleReveal = useCallback(async (field: 'password' | 'totpSecret') => {
    if (!selection) return
    if (reveal && reveal.id === selection.id && reveal.field === field) {
      setReveal(null)
      return
    }
    await revealSecret(selection.id, field, true)
  }, [selection, reveal, revealSecret])

  const handleCopySecret = useCallback(async (field: 'password' | 'totpSecret') => {
    if (!selection) return
    const alreadyShown = reveal !== null && reveal.id === selection.id && reveal.field === field
    const value = await revealSecret(selection.id, field, alreadyShown)
    if (value !== null) await copyText(value)
  }, [selection, reveal, revealSecret, copyText])

  const handleSave = useCallback(async (submit: VaultDialogSubmit) => {
    setBusy(true)
    setVaultError(null)
    try {
      const editing = dialog.initial
      let saved: KeeperItemView
      if (editing) {
        // Patch carries explicit (possibly empty) values so clearing a field in
        // the dialog also clears it in the vault.
        saved = await window.electronAPI.keeperUpdate({
          id: editing.id,
          patch: {
            kind: submit.input.kind,
            title: submit.input.title,
            username: submit.input.username ?? '',
            url: submit.input.url ?? '',
            notes: submit.input.notes ?? '',
            tags: submit.input.tags,
            folders: submit.input.folders,
            favorite: submit.input.favorite === true,
            expiresAt: submit.input.expiresAt ?? 0,
            ...(submit.clearPassword
              ? { clearPassword: true }
              : submit.input.password !== undefined ? { password: submit.input.password } : {}),
            ...(submit.clearTotpSecret
              ? { clearTotpSecret: true }
              : submit.input.totpSecret !== undefined ? { totpSecret: submit.input.totpSecret } : {}),
          },
        })
      } else {
        saved = await window.electronAPI.keeperCreate({ item: submit.input })
      }
      setDialog({ open: false, initial: null })
      setSelectedId(saved.id)
      await loadVault()
    } catch (error) {
      setVaultError(toErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [dialog.initial, loadVault])

  const handleDelete = useCallback(async () => {
    if (!selection) return
    if (!window.confirm(t('extraScreens.secrets.vault.deleteConfirm', { title: selection.title }))) return
    setBusy(true)
    try {
      await window.electronAPI.keeperDelete(selection.id)
      setSelectedId(null)
      setReveal(null)
      await loadVault()
    } catch (error) {
      setVaultError(toErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }, [selection, loadVault, t])

  const handleToggleFavorite = useCallback(async () => {
    if (!selection) return
    try {
      await window.electronAPI.keeperUpdate({ id: selection.id, patch: { favorite: !selection.favorite } })
      await refreshSelection(selection.id)
    } catch (error) {
      setVaultError(toErrorMessage(error))
    }
  }, [selection, refreshSelection])

  const handleImportBrowser = useCallback(async () => {
    setImporting(true)
    setVaultError(null)
    try {
      const result = await window.electronAPI.keeperImportBrowser()
      await loadVault()
      setToast(t('extraScreens.secrets.vault.importDone', { added: result.added, updated: result.updated }))
    } catch (error) {
      setToast(toErrorMessage(error))
    } finally {
      setImporting(false)
    }
  }, [loadVault, t])

  // --- Provider handlers ----------------------------------------------
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

  // --- Organization (Rox Keeper fabric) section -----------------------
  const keeperRpc = useMemo(() => resolveKeeperVaultRpc(window.electronAPI), [])
  const keeperScope = useMemo<KeeperScope | null>(() => {
    const projectId = (preview?.projectId ?? form.projectId).trim()
    const environment = (preview?.environment ?? form.environment).trim()
    const secretPath = (preview?.secretPath ?? form.secretPath).trim() || '/'
    return projectId !== '' && environment !== '' ? { projectId, environment, secretPath } : null
  }, [preview, form.projectId, form.environment, form.secretPath])

  // «Поделиться с командой» — copy one personal item into the org (Rox Keeper)
  // store. No batch: one explicit share per selected item.
  const shareSelectedToTeam = useCallback(async () => {
    if (!selection) return
    if (!keeperRpc || !keeperScope) {
      setShareError(t('extraScreens.keeper.error.orgNotConnected'))
      return
    }
    setSharing(true)
    setShareError(null)
    try {
      let password = ''
      if (selection.hasPassword) {
        password = (await window.electronAPI.keeperReveal({ id: selection.id, field: 'password' })).value
      }
      const { projectId, environment, secretPath } = keeperScope
      const listing = await keeperRpc.fabricInfisicalListItems({ projectId, environment, secretPath })
      const existingKeys = (listing.items ?? []).map((item) => item.key)
      const value: KeeperItemValue = {
        type: isKeeperItemType(selection.kind) ? selection.kind : 'login',
        title: selection.title,
      }
      if (selection.username) value.username = selection.username
      if (password !== '') value.password = password
      if (selection.url) value.url = selection.url
      if (selection.notes) value.notes = selection.notes
      await keeperRpc.fabricInfisicalUpsertItem({
        projectId,
        environment,
        secretPath,
        key: deriveItemKey(selection.title, existingKeys),
        valueJson: value,
      })
      setToast(t('extraScreens.keeper.shareDone'))
    } catch (error) {
      setShareError(toErrorMessage(error))
    } finally {
      setSharing(false)
    }
  }, [selection, keeperRpc, keeperScope, t])

  const sectionSwitch = (
    <>
      <Chip active={section === 'personal'} onClick={() => setSection('personal')}>
        {t('extraScreens.keeper.space.personal')}
      </Chip>
      <Chip active={section === 'organization'} onClick={() => setSection('organization')}>
        {t('extraScreens.keeper.space.organization')}
      </Chip>
    </>
  )

  if (section === 'organization' && keeperRpc && keeperScope) {
    return <KeeperItemsPane scope={keeperScope} rpc={keeperRpc} actions={sectionSwitch} />
  }

  return (
    <ScreenRoot>
      <ScreenColumn width="clamp(260px, 34%, 360px)">
        <ScreenHeader
          title={t('extraScreens.secrets.title')}
          actions={sectionSwitch}
        />

        {section === 'personal' ? (
          <>
            <div className="flex items-center gap-2 px-4 pb-2">
              <ScreenButton variant="primary" onClick={() => setDialog({ open: true, initial: null })} disabled={unlock ? !unlock.available : false}>
                {t('extraScreens.secrets.vault.newItem')}
              </ScreenButton>
              <ScreenButton variant="ghost" onClick={() => void loadVault()}>
                {t('extraScreens.secrets.refresh')}
              </ScreenButton>
            </div>
            {vaultError && <div className="px-4 pb-2 text-small text-destructive" role="alert">{vaultError}</div>}
            <VaultPanel
              snapshot={snapshot}
              unlock={unlock}
              filter={filter}
              selectedId={selectedId}
              onFilterChange={setFilter}
              onSelect={(item) => { setSelectedId(item.id); setReveal(null); setShareError(null) }}
              onImportBrowser={handleImportBrowser}
              importing={importing}
            />
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <SectionLabel>{t('extraScreens.secrets.providerTitle')}</SectionLabel>
            {keeperScope === null && (
              <div className="pb-2 text-small text-muted-foreground">
                {keeperRpc === null ? t('extraScreens.keeper.error.unavailable') : t('extraScreens.keeper.scopeHint')}
              </div>
            )}
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
                  <span className="min-w-0 flex-1 truncate font-mono text-small" title={ref.name}>{ref.name}</span>
                  <span className="shrink-0 truncate font-mono text-small text-muted-foreground" title={ref.envVar}>{ref.envVar}</span>
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
        )}
      </ScreenColumn>

      <ScreenDetail className="overflow-x-hidden">
        {section === 'personal' ? (
          selection ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ScreenButton onClick={() => void shareSelectedToTeam()} disabled={sharing}>
                  {sharing ? t('extraScreens.keeper.sharing') : t('extraScreens.keeper.shareToggle')}
                </ScreenButton>
                {shareError && (
                  <span className="text-small text-destructive" role="alert">
                    {shareError}
                  </span>
                )}
              </div>
              <VaultItemDetail
                item={selection}
                revealedField={reveal && reveal.id === selection.id ? reveal.field : null}
                revealedValue={reveal && reveal.id === selection.id ? reveal.value : null}
                busy={busy}
                onToggleReveal={handleToggleReveal}
                onCopySecret={handleCopySecret}
                onCopyText={copyText}
                onEdit={() => setDialog({ open: true, initial: selection })}
                onDelete={handleDelete}
                onToggleFavorite={handleToggleFavorite}
                onRefreshTotp={() => void loadVault()}
              />
            </>
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 px-8 text-center">
              <div className="text-title-sm font-bold">{t('extraScreens.secrets.vault.selectTitle')}</div>
              <div className="max-w-[440px] text-muted-foreground">{t('extraScreens.secrets.vault.selectBody')}</div>
            </div>
          )
        ) : (
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
        )}
      </ScreenDetail>

      <VaultItemDialog
        open={dialog.open}
        initial={dialog.initial}
        busy={busy}
        onSubmit={handleSave}
        onClose={() => setDialog({ open: false, initial: null })}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-toast -translate-x-1/2 rounded-[var(--radius-control)] bg-foreground-90 px-3 py-1.5 text-small text-background shadow-lg" role="status">
          {toast}
        </div>
      )}
    </ScreenRoot>
  )
}