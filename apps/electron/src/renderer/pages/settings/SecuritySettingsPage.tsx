import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AuditMode,
  OpenClawRuntimeStatus,
  SecurityAuditSnapshot,
  SecurityDomain,
  SecurityFinding,
} from '@rox/shared/openclaw'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { SettingsCard, SettingsSection } from '@/components/settings'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { routes } from '@/lib/navigate'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PremiumMenuSelect } from '@rox/ui'
import { SecuritySnake, filterSecurityFindings } from './security/SecuritySnake'
import { runConfirmedSecurityAction } from './security/security-actions'
import { RoxRuntimeCard } from './security/RoxRuntimeCard'
import { createSecurityResource, type SecurityResourceState } from './security/security-resource'
import { RPC_CHANNELS } from '../../../shared/types'
import {
  RISK_ACCEPTANCE_MAX_CODE_POINTS,
  getRiskAcceptanceDateLimits,
  validateRiskAcceptance,
} from './security/security-validation'
import { isClaimableLive } from '@rox/core/rox2'
import { settingsPageActionResult, type SettingsPageActionKind } from './settings-rox2-surface'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'security',
}

type PendingSecurityAction =
  | { readonly kind: 'install' }
  | { readonly kind: 'provision' }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'audit'; readonly mode: AuditMode }
  | {
      readonly kind: 'accept'
      readonly fingerprint: string
      readonly checkId: string
      readonly rationale: string
      readonly expiresAt: number
    }
  | { readonly kind: 'revoke'; readonly fingerprint: string; readonly checkId: string }
  | { readonly kind: 'openControlUi' }
  | { readonly kind: 'copySetupCredential' }

function securityActionLive(kind: PendingSecurityAction['kind']): boolean {
  const spec: { action: SettingsPageActionKind; granted?: boolean } =
    kind === 'install' || kind === 'provision' || kind === 'start'
      ? { action: 'install', granted: true }
      : kind === 'stop'
        ? { action: 'toggle' }
        : kind === 'audit'
          ? { action: 'scan', granted: true }
          : kind === 'accept'
            ? { action: 'persist' }
            : kind === 'revoke'
              ? { action: 'uninstall', granted: true }
              : { action: 'config-read', granted: true }
  return isClaimableLive(
    settingsPageActionResult({ pageId: 'security', source: 'native', ...spec }),
  )
}

type SnapshotFreshness = 'unknown' | 'fresh' | 'stale'

const RUNTIME_ACTIONABLE_STATES: Partial<Record<OpenClawRuntimeStatus['state'], true>> = {
  provisioned: true,
  stopped: true,
  degraded: true,
  failed: true,
}

function updateFindingAcceptance(
  snapshot: SecurityAuditSnapshot | null,
  fingerprint: string,
  acceptance: SecurityFinding['acceptance'],
): SecurityAuditSnapshot | null {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    findings: snapshot.findings.map((finding) =>
      finding.fingerprint === fingerprint ? { ...finding, acceptance } : finding,
    ),
  }
}

export default function SecuritySettingsPage() {
  const { t, i18n } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id
  const hostControl = window.openClawHostControl
  const [runtimeStatus, setRuntimeStatus] = React.useState<OpenClawRuntimeStatus | null>(null)
  const [snapshot, setSnapshot] = React.useState<SecurityAuditSnapshot | null>(null)
  const [snapshotFreshness, setSnapshotFreshness] = React.useState<SnapshotFreshness>('unknown')
  const [runtimeResource, setRuntimeResource] = React.useState<SecurityResourceState<OpenClawRuntimeStatus>>({ scope: null, phase: 'loading', data: null })
  const [auditResource, setAuditResource] = React.useState<SecurityResourceState<SecurityAuditSnapshot | null>>({ scope: null, phase: 'loading', data: null })
  const workspaceEpoch = React.useRef({ workspaceId, generation: 0 })
  if (workspaceEpoch.current.workspaceId !== workspaceId) workspaceEpoch.current = { workspaceId, generation: workspaceEpoch.current.generation + 1 }
  const runtimeLoader = React.useMemo(() => createSecurityResource<OpenClawRuntimeStatus>(state => {
    setRuntimeResource(state)
    if (state.phase === 'available') setRuntimeStatus(state.data)
  }), [])
  const auditLoader = React.useMemo(() => createSecurityResource<SecurityAuditSnapshot | null>(state => {
    setAuditResource(state)
    if (state.phase === 'available') { setSnapshot(state.data); setSnapshotFreshness(state.data ? 'fresh' : 'unknown') }
    else if (state.phase === 'failed') setSnapshotFreshness('stale')
  }), [])
  const [actionError, setActionError] = React.useState(false)
  const [auditRunning, setAuditRunning] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<PendingSecurityAction['kind'] | null>(null)
  const [pendingAction, setPendingAction] = React.useState<PendingSecurityAction | null>(null)
  const [selectedDomain, setSelectedDomain] = React.useState<SecurityDomain | null>(null)
  const [selectedFingerprint, setSelectedFingerprint] = React.useState<string | null>(null)
  const [adviceFingerprint, setAdviceFingerprint] = React.useState<string | null>(null)
  const [acceptanceFinding, setAcceptanceFinding] = React.useState<SecurityFinding | null>(null)
  const [rationale, setRationale] = React.useState('')
  const [expiresOn, setExpiresOn] = React.useState('')
  const [infisicalHealth, setInfisicalHealth] = React.useState<
    'unknown' | 'checking' | 'available' | 'unavailable'
  >('unknown')

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(i18n.language || 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  const dateLimits = getRiskAcceptanceDateLimits()
  const acceptanceValidation = validateRiskAcceptance({ rationale, expiresOn })
  const displayedRuntime = runtimeStatus?.workspaceId === workspaceId ? runtimeStatus : null
  const displayedSnapshot = snapshot?.workspaceId === workspaceId ? snapshot : null
  const available = (channel: string, method: unknown) => typeof method === 'function'
    && (typeof window.electronAPI?.isChannelAvailable !== 'function' || window.electronAPI.isChannelAvailable(channel))
  const runtimeApiAvailable = available(RPC_CHANNELS.openclawRuntime.GET_STATUS, window.electronAPI?.openclawRuntime?.getStatus)
  const auditApiAvailable = available(RPC_CHANNELS.securityAudit.GET_LATEST, window.electronAPI?.securityAudit?.getLatest)
  const runtimeLoading = runtimeResource.scope !== workspaceId ? Boolean(workspaceId) : runtimeResource.phase === 'loading'
  const auditLoading = auditResource.scope !== workspaceId ? Boolean(workspaceId) : auditResource.phase === 'loading'
  const loading = runtimeLoading || auditLoading

  const checkInfisicalHealth = React.useCallback(async () => {
    const probe = window.electronAPI?.fabricInfisicalHealth
    if (typeof probe !== 'function') {
      setInfisicalHealth('unavailable')
      return
    }
    setInfisicalHealth('checking')
    try {
      const result = await probe()
      setInfisicalHealth(result.available ? 'available' : 'unavailable')
    } catch {
      setInfisicalHealth('unavailable')
    }
  }, [])

  React.useEffect(() => {
    void checkInfisicalHealth()
  }, [checkInfisicalHealth])

  const refreshRuntime = React.useCallback(() => {
    const api = window.electronAPI?.openclawRuntime
    return runtimeLoader.read(workspaceId ?? null, runtimeApiAvailable && api ? async () => {
      const result = await api.getStatus({ workspaceId: workspaceId! })
      if (result.workspaceId !== workspaceId) throw new Error('Runtime workspace changed')
      return result
    } : undefined)
  }, [runtimeApiAvailable, runtimeLoader, workspaceId])
  const refreshAudit = React.useCallback(() => {
    const api = window.electronAPI?.securityAudit
    return auditLoader.read(workspaceId ?? null, auditApiAvailable && api ? async () => {
      const result = await api.getLatest({ workspaceId: workspaceId! })
      if (result && result.workspaceId !== workspaceId) throw new Error('Audit workspace changed')
      return result
    } : undefined)
  }, [auditApiAvailable, auditLoader, workspaceId])
  const refresh = React.useCallback(() => Promise.all([refreshRuntime(), refreshAudit()]), [refreshRuntime, refreshAudit])
  React.useEffect(() => { void refreshRuntime(); return () => runtimeLoader.cancel() }, [refreshRuntime, runtimeLoader])
  React.useEffect(() => { void refreshAudit(); return () => auditLoader.cancel() }, [refreshAudit, auditLoader])
  React.useEffect(() => {
    setPendingAction(null); setAcceptanceFinding(null); setSnapshotFreshness('unknown')
    setActionError(false); setBusyAction(null); setAuditRunning(false)
  }, [workspaceId])

  const performPendingAction = React.useCallback(async (action: PendingSecurityAction) => {
    if (!workspaceId || !securityActionLive(action.kind)) return
    const captured = workspaceEpoch.current
    const isCurrent = () => workspaceEpoch.current === captured
    const runtimeApi = window.electronAPI?.openclawRuntime
    const auditApi = window.electronAPI?.securityAudit
    const applyRuntime = (result: OpenClawRuntimeStatus) => {
      if (isCurrent() && result.workspaceId === workspaceId) runtimeLoader.replace(workspaceId, result)
    }
    switch (action.kind) {
      case 'install':
        if (!runtimeApi?.install) throw new Error('Runtime installation unavailable')
        applyRuntime(await runtimeApi.install({ workspaceId })); break
      case 'provision':
        if (!runtimeApi?.provision) throw new Error('Runtime provisioning unavailable')
        applyRuntime(await runtimeApi.provision({ workspaceId })); break
      case 'start':
        if (!runtimeApi?.start) throw new Error('Runtime start unavailable')
        applyRuntime(await runtimeApi.start({ workspaceId })); break
      case 'stop':
        if (!runtimeApi?.stop) throw new Error('Runtime stop unavailable')
        applyRuntime(await runtimeApi.stop({ workspaceId })); break
      case 'audit': {
        if (!auditApi?.run) throw new Error('Audit unavailable')
        setAuditRunning(true)
        try {
          const next = await auditApi.run({ workspaceId, mode: action.mode })
          if (isCurrent() && next.workspaceId === workspaceId) {
            auditLoader.replace(workspaceId, next); applyRuntime(next.runtime)
          }
        } catch (error) {
          if (isCurrent()) setSnapshotFreshness('stale')
          throw error
        } finally { if (isCurrent()) setAuditRunning(false) }
        break
      }
      case 'accept':
        if (!auditApi?.acceptRisk) throw new Error('Risk acceptance unavailable')
        await auditApi.acceptRisk({ workspaceId, fingerprint: action.fingerprint, rationale: action.rationale, expiresAt: action.expiresAt })
        if (isCurrent()) setSnapshot(previous => updateFindingAcceptance(previous, action.fingerprint, {
          rationale: action.rationale, expiresAt: action.expiresAt, expired: false,
        }))
        break
      case 'revoke':
        if (!auditApi?.revokeRiskAcceptance) throw new Error('Risk acceptance unavailable')
        await auditApi.revokeRiskAcceptance({ workspaceId, fingerprint: action.fingerprint })
        if (isCurrent()) setSnapshot(previous => updateFindingAcceptance(previous, action.fingerprint, undefined))
        break
      case 'openControlUi':
        if (!window.openClawHostControl) throw new Error('Host controls unavailable')
        await window.openClawHostControl.openControlUi({ workspaceId }); break
      case 'copySetupCredential':
        if (!window.openClawHostControl) throw new Error('Host controls unavailable')
        await window.openClawHostControl.copyGatewayTokenForSetup({ workspaceId }); break
    }
  }, [auditLoader, runtimeLoader, workspaceId])

  const confirmPendingAction = React.useCallback(async () => {
    const action = pendingAction
    const captured = workspaceEpoch.current
    setPendingAction(null)
    if (!action) return
    setBusyAction(action.kind); setActionError(false)
    try { await runConfirmedSecurityAction(action, performPendingAction) }
    catch { if (workspaceEpoch.current === captured) setActionError(true) }
    finally { if (workspaceEpoch.current === captured) setBusyAction(null) }
  }, [pendingAction, performPendingAction])

  const findings = displayedSnapshot?.findings ?? []
  const filteredFindings = filterSecurityFindings(findings, selectedDomain)
  const acceptedCount = findings.filter((finding) => finding.acceptance && !finding.acceptance.expired).length
  const deepCoverage = displayedSnapshot?.coverage.deep ?? 'not-requested'
  const deepCoverageKey = deepCoverage === 'not-requested' ? 'notRequested' : deepCoverage
  const snapshotIsStale = displayedSnapshot !== null && snapshotFreshness === 'stale'
  const snapshotDate = displayedSnapshot ? dateFormatter.format(new Date(displayedSnapshot.completedAt)) : null
  const isBusy = busyAction !== null || auditRunning
  const runtimeState = displayedRuntime?.state
  const canProvision = !runtimeState || !['installing', 'starting', 'running'].includes(runtimeState)
  const canStart = runtimeState ? Boolean(RUNTIME_ACTIONABLE_STATES[runtimeState]) : false
  const canStop = runtimeState === 'running' || runtimeState === 'starting' || runtimeState === 'degraded'
  const confirmationActionKey =
    pendingAction?.kind === 'audit'
      ? pendingAction.mode === 'deep'
        ? 'security.action.deepAudit'
        : 'security.action.audit'
      : pendingAction
        ? {
            install: 'security.action.install',
            provision: 'security.action.provision',
            start: 'security.action.start',
            stop: 'security.action.stop',
            accept: 'security.finding.acceptRisk',
            revoke: 'security.finding.revokeRisk',
            openControlUi: 'security.action.openControlUi',
            copySetupCredential: 'security.action.copySetupCredential',
          }[pendingAction.kind]
        : 'security.action.audit'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.security.title')}
        actions={
          <>
            <Button size="sm" variant="outline" disabled={loading || !workspaceId} onClick={() => void refresh()}>
              {loading ? t('security.loading') : t('security.action.refresh')}
            </Button>
            <HeaderMenu route={routes.view.settings('security')} />
          </>
        }
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
          <p className="whitespace-normal break-words text-sm text-muted-foreground">
            {t('settings.security.description')}
          </p>
          {!workspaceId && (
            <div role="alert" className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              {t('security.error.noWorkspace')}
            </div>
          )}
          {actionError && (
            <div role="alert" className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              {t('security.error.actionFailed')}
            </div>
          )}

          <RoxRuntimeCard workspaceId={workspaceId} remote={Boolean(activeWorkspace?.remoteServer)} />

          <SettingsSection title={t('security.openclaw.title')}>
            <SettingsCard className="space-y-4 p-4">
              <p className="text-sm text-muted-foreground">{t('security.openclaw.description')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.runtime.openclawLabel')}</p>
                  <p className="mt-1 text-sm font-medium" aria-live="polite">
                    {runtimeLoading ? t('security.loading') : t(`security.runtime.state.${displayedRuntime?.state ?? 'unavailable'}`)}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.audit.lastRun')}</p>
                  <p className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? dateFormatter.format(new Date(displayedSnapshot.completedAt)) : t('security.audit.none')}
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">{t('security.audit.status')}</p>
                  <p className="mt-1 text-sm font-medium" role="status" aria-live="polite" aria-atomic="true">
                    {auditRunning
                      ? t('security.audit.running')
                      : auditLoading && !snapshotDate ? t('security.loading')
                      : auditLoading && snapshotDate
                        ? t('security.audit.refreshingLastSnapshot', { date: snapshotDate })
                        : snapshotIsStale && snapshotDate
                          ? t('security.audit.stale', { date: snapshotDate })
                          : displayedSnapshot
                            ? t('security.audit.ready')
                            : t('security.audit.none')}
                  </p>
                </div>
              </div>

              {workspaceId && runtimeResource.scope === workspaceId && ['failed', 'unavailable'].includes(runtimeResource.phase) && <div role="status" className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="security-openclaw-error">
                <p>{t(runtimeResource.phase === 'failed' ? 'security.openclaw.loadFailed' : 'security.openclaw.unavailable')}</p>
                <Button size="sm" variant="outline" className="mt-2" disabled={runtimeLoading} onClick={() => void refreshRuntime()}>{t('security.openclaw.refresh')}</Button>
              </div>}
              {workspaceId && auditResource.scope === workspaceId && ['failed', 'unavailable'].includes(auditResource.phase) && <div role="status" className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="security-audit-error">
                <p>{t(auditResource.phase === 'failed' ? 'security.error.loadFailed' : 'security.error.auditUnavailable')}</p>
                <Button size="sm" variant="outline" className="mt-2" disabled={auditLoading} onClick={() => void refreshAudit()}>{t('security.audit.refresh')}</Button>
              </div>}
              {displayedRuntime?.safeError && (
                <p role="alert" className="text-sm text-destructive">
                  {displayedRuntime.safeError === 'RUNTIME_MISSING' ? t('security.openclaw.missing') : t('security.error.runtimeUnavailable')}

                </p>
              )}
              {displayedSnapshot?.safeError && (
                <p role="alert" className="text-sm text-destructive">
                  {t('security.error.auditUnavailable')}
                </p>
              )}

              <div className="flex flex-wrap gap-2" aria-label={t('security.section.controls')}>
                {(!runtimeState || runtimeState === 'unavailable' || runtimeState === 'unsupported') && (
                  <Button size="sm" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.openclawRuntime.INSTALL, window.electronAPI?.openclawRuntime?.install)} onClick={() => setPendingAction({ kind: 'install' })}>
                    {t('security.action.install')}
                  </Button>
                )}
                {canProvision && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.openclawRuntime.PROVISION, window.electronAPI?.openclawRuntime?.provision)} onClick={() => setPendingAction({ kind: 'provision' })}>
                    {t('security.action.provision')}
                  </Button>
                )}
                {canStart && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.openclawRuntime.START, window.electronAPI?.openclawRuntime?.start)} onClick={() => setPendingAction({ kind: 'start' })}>
                    {t('security.action.start')}
                  </Button>
                )}
                {canStop && (
                  <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.openclawRuntime.STOP, window.electronAPI?.openclawRuntime?.stop)} onClick={() => setPendingAction({ kind: 'stop' })}>
                    {t('security.action.stop')}
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.securityAudit.RUN, window.electronAPI?.securityAudit?.run)} onClick={() => setPendingAction({ kind: 'audit', mode: 'standard' })}>
                  {t('security.action.audit')}
                </Button>
                <Button size="sm" variant="outline" disabled={isBusy || !workspaceId || !available(RPC_CHANNELS.securityAudit.RUN, window.electronAPI?.securityAudit?.run)} onClick={() => setPendingAction({ kind: 'audit', mode: 'deep' })}>
                  {t('security.action.deepAudit')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('security.section.vault')}>
            <SettingsCard className="space-y-3">
              <div>
                <p className="text-sm font-medium">{t('security.infisical.title')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('security.infisical.hint')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium" role="status" aria-live="polite">
                  {infisicalHealth === 'available'
                    ? t('security.infisical.status.available')
                    : infisicalHealth === 'unavailable'
                      ? t('security.infisical.status.unavailable')
                      : t('security.loading')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={infisicalHealth === 'checking'}
                  onClick={() => void checkInfisicalHealth()}
                >
                  {t('security.infisical.check')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('security.section.coverage')}>
            <SettingsCard>
              <dl className="grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.craft')}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? t(`security.coverage.${displayedSnapshot.coverage.craft}`) : t('security.coverage.notRequested')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.openclaw')}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {displayedSnapshot ? t(`security.coverage.${displayedSnapshot.coverage.openclaw}`) : t('security.coverage.notRequested')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('security.coverage.deep')}</dt>
                  <dd className="mt-1 text-sm font-medium">{t(`security.coverage.${deepCoverageKey}`)}</dd>
                </div>
              </dl>
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('security.section.summary')}>
            <SettingsCard>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.critical')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.critical ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.warning')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.warn ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.info')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.info ?? 0}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.accepted')}</dt><dd className="text-lg font-semibold">{acceptedCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{t('security.summary.unavailable')}</dt><dd className="text-lg font-semibold">{displayedSnapshot?.summary.unavailable ?? 0}</dd></div>
              </dl>
            </SettingsCard>
          </SettingsSection>

          <SettingsCard className="p-4">
            <SecuritySnake
              domains={displayedSnapshot?.domains ?? []}
              selectedDomain={selectedDomain}
              onSelectDomain={(domain) => setSelectedDomain(domain)}
            />
          </SettingsCard>

          <SettingsSection title={t('security.section.findings')}>
            <SettingsCard className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t('security.filter.label')}</span>
                <PremiumMenuSelect
                  aria-label={t('security.filter.label')}
                  className="h-8 max-w-[200px]"
                  items={[
                    { id: 'all', label: t('security.filter.all') },
                    { id: 'ingress', label: t('security.snake.domain.ingress') },
                    { id: 'sessions', label: t('security.snake.domain.sessions') },
                    { id: 'tools', label: t('security.snake.domain.tools') },
                    { id: 'secrets', label: t('security.snake.domain.secrets') },
                    { id: 'network', label: t('security.snake.domain.network') },
                    { id: 'extensions', label: t('security.snake.domain.extensions') },
                    { id: 'isolation', label: t('security.snake.domain.isolation') },
                    { id: 'other', label: t('security.filter.other') },
                  ]}
                  selectedId={selectedDomain ?? 'all'}
                  placeholder={t('security.filter.label')}
                  onSelect={(item) => setSelectedDomain(item.id === 'all' ? null : item.id as SecurityDomain)}
                  variant="compact"
                />
                {selectedDomain && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedDomain(null)}>
                    {t('security.action.clearFilter')}
                  </Button>
                )}
              </div>

              {!displayedSnapshot && (
                <p role="status" className="text-sm text-muted-foreground">
                  {loading ? t('security.loading') : t('security.audit.none')}
                </p>
              )}
              {displayedSnapshot && filteredFindings.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">{t('security.finding.empty')}</p>
              )}
              <div className="space-y-3">
                {filteredFindings.map((finding) => {
                  const isSelected = selectedFingerprint === finding.fingerprint
                  const isAdviceVisible = adviceFingerprint === finding.fingerprint
                  const domainLabel = finding.domain === 'other'
                    ? t('security.filter.other')
                    : t(`security.snake.domain.${finding.domain}`)
                  const severityLabel = t(`security.snake.status.${finding.severity}`)
                  const statusLabel = finding.acceptance?.expired
                    ? t('security.finding.statusExpired')
                    : finding.acceptance
                      ? t('security.finding.statusAccepted')
                      : finding.severity === 'unavailable'
                        ? t('security.finding.statusUnavailable')
                        : t('security.finding.statusOpen')

                  return (
                    <article key={finding.fingerprint} className="rounded-md border border-border/60 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words text-sm font-semibold">{finding.title}</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t('security.finding.check')}: {finding.checkId} · {t('security.finding.source')}: {finding.source === 'craft' ? t('security.finding.sourceCraft') : t('security.finding.sourceOpenClaw')} · {domainLabel} · {severityLabel} · {statusLabel}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          aria-expanded={isSelected}
                          onClick={() => setSelectedFingerprint(isSelected ? null : finding.fingerprint)}
                        >
                          {isSelected ? t('security.finding.hideDetails') : t('security.finding.showDetails')}
                        </Button>
                      </div>

                      {isSelected && (
                        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.what')}</h4>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">{finding.detail}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.why')}</h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t('security.finding.whyDescription', { domain: domainLabel, severity: severityLabel })}
                            </p>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium">{t('security.finding.whatToDo')}</h4>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                              {finding.remediation ?? t('security.finding.fixAdvice')}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('security.finding.detected')}: {dateFormatter.format(new Date(finding.detectedAt))} · {statusLabel}
                            {finding.acceptance && !finding.acceptance.expired ? ` · ${t('security.finding.acceptedUntil', { date: dateFormatter.format(new Date(finding.acceptance.expiresAt)) })}` : ''}
                          </p>
                          {isAdviceVisible && (
                            <p className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                              {t('security.finding.fixAdvice')}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setSelectedFingerprint(null)}>
                              {t('security.finding.leave')}
                            </Button>
                            {!finding.acceptance || finding.acceptance.expired ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy || !available(RPC_CHANNELS.securityAudit.ACCEPT_RISK, window.electronAPI?.securityAudit?.acceptRisk)}
                                onClick={() => {
                                  setAcceptanceFinding(finding)
                                  setRationale('')
                                  setExpiresOn(getRiskAcceptanceDateLimits().min)
                                }}
                              >
                                {t('security.finding.acceptRisk')}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy || !available(RPC_CHANNELS.securityAudit.REVOKE_RISK_ACCEPTANCE, window.electronAPI?.securityAudit?.revokeRiskAcceptance)}
                                onClick={() => setPendingAction({ kind: 'revoke', fingerprint: finding.fingerprint, checkId: finding.checkId })}
                              >
                                {t('security.finding.revokeRisk')}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setAdviceFingerprint(isAdviceVisible ? null : finding.fingerprint)}>
                              {t('security.finding.fix')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </SettingsCard>
          </SettingsSection>

          {hostControl && (
            <SettingsSection title={t('security.section.hostControls')}>
              <SettingsCard className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('security.hostControls.description')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !workspaceId || !displayedRuntime || displayedRuntime.state === 'unavailable'}
                    onClick={() => setPendingAction({ kind: 'openControlUi' })}
                  >
                    {t('security.action.openControlUi')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !workspaceId || !displayedRuntime || displayedRuntime.state === 'unavailable'}
                    onClick={() => setPendingAction({ kind: 'copySetupCredential' })}
                  >
                    {t('security.action.copySetupCredential')}
                  </Button>
                </div>
              </SettingsCard>
            </SettingsSection>
          )}
          {!hostControl && (
            <div role="note" className="rounded-md border border-border px-3 py-3 text-sm text-muted-foreground">
              <p className="font-medium">HOST_ONLY · {t('security.hostOnly.title')}</p>
              <p className="mt-1">{t('security.hostOnly.description')}</p>
            </div>
          )}
          </div>
        </ScrollArea>
      </div>

      <Dialog
        open={acceptanceFinding !== null}
        onOpenChange={(open) => {
          if (!open) setAcceptanceFinding(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.acceptance.title')}</DialogTitle>
            <DialogDescription>{t('security.acceptance.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="security-risk-rationale" className="text-sm font-medium">{t('security.acceptance.rationale')}</label>
              <Textarea
                id="security-risk-rationale"
                value={rationale}
                maxLength={RISK_ACCEPTANCE_MAX_CODE_POINTS * 2}
                onChange={(event) => setRationale(event.target.value)}
                aria-invalid={rationale.length > 0 && (acceptanceValidation.rationaleCodePoints < 10 || acceptanceValidation.rationaleCodePoints > 500)}
              />
              <p className="text-xs text-muted-foreground">
                {t('security.acceptance.rationaleHint', { count: acceptanceValidation.rationaleCodePoints })}
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="security-risk-expiry" className="text-sm font-medium">{t('security.acceptance.expiry')}</label>
              <Input
                id="security-risk-expiry"
                type="date"
                min={dateLimits.min}
                max={dateLimits.max}
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                aria-invalid={expiresOn.length > 0 && acceptanceValidation.calendarDays === null}
              />
              <p className="text-xs text-muted-foreground">{t('security.acceptance.expiryHint')}</p>
              {acceptanceValidation.valid && acceptanceValidation.expiresAt !== null && (
                <p className="text-xs font-medium">{t('security.acceptance.expiresAt', { date: dateFormatter.format(new Date(acceptanceValidation.expiresAt)) })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptanceFinding(null)}>{t('common.cancel')}</Button>
            <Button
              disabled={!acceptanceFinding || !acceptanceValidation.valid || acceptanceValidation.expiresAt === null}
              onClick={() => {
                if (!acceptanceFinding || !acceptanceValidation.valid || acceptanceValidation.expiresAt === null) return
                setPendingAction({
                  kind: 'accept',
                  fingerprint: acceptanceFinding.fingerprint,
                  checkId: acceptanceFinding.checkId,
                  rationale: acceptanceValidation.rationale,
                  expiresAt: acceptanceValidation.expiresAt,
                })
                setAcceptanceFinding(null)
              }}
            >
              {t('security.finding.acceptRisk')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('security.confirm.title', { action: t(confirmationActionKey) })}</DialogTitle>
            <DialogDescription>
              {t('security.confirm.scope', {
                action: t(confirmationActionKey),
                workspace: activeWorkspace?.name ?? t('security.confirm.currentWorkspace'),
              })}
            </DialogDescription>
          </DialogHeader>
          {pendingAction?.kind === 'accept' && (
            <p className="text-sm text-muted-foreground">
              {t('security.confirm.expiry', { date: dateFormatter.format(new Date(pendingAction.expiresAt)) })}
            </p>
          )}
          {(pendingAction?.kind === 'accept' || pendingAction?.kind === 'revoke') && (
            <p className="text-sm text-muted-foreground">
              {t('security.confirm.finding', { checkId: pendingAction.checkId })}
            </p>
          )}
          {pendingAction?.kind === 'copySetupCredential' && (
            <p className="text-sm text-muted-foreground">{t('security.confirm.copySetupCredential')}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>{t('common.cancel')}</Button>
            <Button disabled={busyAction !== null} onClick={() => void confirmPendingAction()}>
              {t(confirmationActionKey)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
