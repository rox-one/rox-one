/**
 * AccountSettingsPage — first settings tab: identity, plan, XP, balance.
 *
 * Central identity and money come from the Pocket account snapshot.
 * Device profile and XP retain their own settings. Plan is a local label.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import {
  SettingsCard,
  SettingsCardFooter,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsToggle,
} from '@/components/settings'
import { KnowledgeMapPanel } from '@/components/knowledge-map/KnowledgeMapPanel'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { QuestProgressCard } from '@/components/app-shell/QuestProgressCard'
import { resolveDisplayName } from '@/components/app-shell/profile-strip-account'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { MiniDashboardCards } from '@/components/app-shell/MiniDashboardCards'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useRoxCloudAccount } from '@/hooks/useRoxCloudAccount'
import { useWorkspaceTaskCount } from '@/hooks/useWorkspaceTaskCount'
import { buildMiniDashboard } from '@/platform/mini-dashboard'
import { isHomeSessionInWorkspace } from '@/platform/home-model'
import { navigate, routes } from '@/lib/navigate'
import { isClaimableLive } from '@rox/core/rox2'
import {
  PROFILE_PLANS,
  type Profile,
  type ProfilePlan,
} from '../../../shared/types'
import { MAIL_DEFAULT_DOMAIN } from '../../../shared/mail-local'
import { settingsPageActionResult } from './settings-rox2-surface'

/**
 * The Standard/Pro/Team/Max picker is only a local label with no billing
 * behind it (audit 2026-09-29: fake control). Hidden until real plans exist.
 */
const SHOW_PLAN_PICKER = false
import type { XpEventType } from '@rox/shared/gamification'
import { toErrorMessage } from '@/lib/errors'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'account',
}

const XP_EVENT_KEYS: Record<XpEventType, string> = {
  session_completed: 'settings.account.event.sessionCompleted',
  automation_ran: 'settings.account.event.automationRan',
  cloud_run_imported: 'settings.account.event.cloudRunImported',
  note_linked: 'settings.account.event.noteLinked',
  first_note: 'settings.account.event.firstNote',
  first_task: 'settings.account.event.firstTask',
  first_workflow: 'settings.account.event.firstWorkflow',
  first_browser: 'settings.account.event.firstBrowser',
  privacy_review: 'settings.account.event.privacyReview',
}

type GamificationSnapshot = {
  xp: number
  level: number
  balance: number | null
  progress: number
  xpIntoLevel: number
  xpForNext: number
  nextThreshold: number | null
  currentThreshold?: number
  recentEvents?: Array<{ type: XpEventType; xp: number; at: number }>
  analyticsConsent?: boolean
}

function errorMessage(error: unknown): string {
  return toErrorMessage(error)
}

function formatBalance(balance: number | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (balance === null || !Number.isFinite(balance)) return t('profile.balanceUnknown')
  return t('profile.balance', { amount: balance })
}

/** HH:MM in the active UI language, for the «Обновлено» sync line. */
function accountSyncTime(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale || undefined, { hour: '2-digit', minute: '2-digit' }).format(at)
}

async function avatarDataUrlFromPickedFile(): Promise<string | null> {
  const paths = await window.electronAPI.openFileDialog()
  const path = paths[0]
  if (!path) return null
  const attachment = await window.electronAPI.readUserAttachment(path)
  if (!attachment || attachment.type !== 'image' || !attachment.base64) {
    throw new Error('image-required')
  }
  const mime = attachment.mimeType.toLowerCase()
  if (mime.includes('svg') || mime.includes('html')) {
    throw new Error('image-required')
  }
  let pngBase64 = attachment.thumbnailBase64
  if (!pngBase64) {
    pngBase64 = (await window.electronAPI.generateThumbnail(attachment.base64, attachment.mimeType)) ?? undefined
  }
  if (!pngBase64) throw new Error('image-required')
  return `data:image/png;base64,${pngBase64}`
}

export default function AccountSettingsPage() {
  const { t, i18n } = useTranslation()
  const workspace = useActiveWorkspace()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const connectionState = useTransportConnectionState()
  const taskCount = useWorkspaceTaskCount(workspace?.id)
  const { account: cloudAccount, connectError: cloudError, updating: cloudUpdating, lastSyncedAt: cloudSyncedAt } = useRoxCloudAccount()
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [displayName, setDisplayName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [mailAddress, setMailAddress] = React.useState<string | null>(null)
  const [mailDomain, setMailDomain] = React.useState(MAIL_DEFAULT_DOMAIN)
  const [saving, setSaving] = React.useState(false)
  const [profileSavedFlash, setProfileSavedFlash] = React.useState(false)
  const [changingAvatar, setChangingAvatar] = React.useState(false)
  const [gamification, setGamification] = React.useState<GamificationSnapshot | null>(null)
  const [savingAnalyticsConsent, setSavingAnalyticsConsent] = React.useState(false)
  const [profileLoadFailed, setProfileLoadFailed] = React.useState(false)
  const profileGeneration = React.useRef(0)
  const invalidateProfileRequest = React.useCallback(() => { ++profileGeneration.current }, [])

  const load = React.useCallback(async () => {
    const generation = ++profileGeneration.current
    const [identity, progress] = await Promise.allSettled([
      window.electronAPI.identityGetState(),
      window.electronAPI.getGamificationProfile(),
    ])
    if (generation !== profileGeneration.current) return
    if (identity.status === 'fulfilled') {
      setProfile(identity.value.profile)
      setDisplayName(identity.value.profile.displayName)
      setEmail(identity.value.profile.email ?? '')
      setProfileLoadFailed(false)
    } else {
      setProfileLoadFailed(true)
      toast.error(t('settings.account.loadFailed', { message: errorMessage(identity.reason) }))
    }
    // XP is a separate service. A failure there must not prevent editing the
    // authenticated profile or turn a successful profile read into a failure.
    if (progress.status === 'fulfilled') setGamification(progress.value)
  }, [t])

  React.useEffect(() => {
    setProfile(null)
    void load()
    const offIdentity = window.electronAPI.onIdentityChanged?.(() => { void load() })
    const offXp = window.electronAPI.onGamificationChanged((payload) => { setGamification(payload) })
    return () => {
      invalidateProfileRequest()
      offIdentity?.()
      offXp()
    }
  }, [load, workspace?.id, invalidateProfileRequest])

  React.useEffect(() => {
    const mail = window.electronAPI.mailLocal
    if (!mail) return
    let cancelled = false
    const read = async () => {
      try {
        const status = await mail.status()
        if (cancelled) return
        setMailAddress(status.address)
        setMailDomain(status.domain || MAIL_DEFAULT_DOMAIN)
      } catch { /* the mail bridge is optional */ }
    }
    void read()
    const off = mail.onChanged(() => { void read() })
    const timer = window.setInterval(() => { void read() }, 30_000)
    return () => { cancelled = true; off(); window.clearInterval(timer) }
  }, [])

  const persist = async (input: Parameters<typeof window.electronAPI.identityUpdateProfile>[0]) => {
    const generation = ++profileGeneration.current
    const next = await window.electronAPI.identityUpdateProfile(input)
    if (generation !== profileGeneration.current) return next.profile
    setProfileLoadFailed(false)
    setProfile(next.profile)
    setDisplayName(next.profile.displayName)
    setEmail(next.profile.email ?? '')
    return next.profile
  }

  const handleSaveProfile = async () => {
    const trimmed = displayName.trim()
    if (!trimmed) return
    setSaving(true)
    setProfileSavedFlash(false)
    try {
      await persist({ displayName: trimmed, email })
      setProfileSavedFlash(true)
      window.setTimeout(() => setProfileSavedFlash(false), 2400)
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: errorMessage(error) }))
    } finally {
      setSaving(false)
    }
  }

  const handlePlanChange = async (plan: ProfilePlan) => {
    const spend = settingsPageActionResult({
      pageId: 'account',
      action: 'spend',
      source: 'native',
      granted: true,
    })
    if (isClaimableLive(spend)) return
    const write = settingsPageActionResult({
      pageId: 'account',
      action: 'plan-write',
      source: 'native',
    })
    if (!isClaimableLive(write)) return
    try {
      await persist({ plan })
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: errorMessage(error) }))
    }
  }

  const handleChangeAvatar = async () => {
    const read = settingsPageActionResult({
      pageId: 'account',
      action: 'avatar-read',
      source: 'native',
      granted: true,
    })
    if (!isClaimableLive(read)) {
      toast.error(t('settings.rox2.grantRequired'))
      return
    }
    setChangingAvatar(true)
    try {
      const dataUrl = await avatarDataUrlFromPickedFile()
      if (!dataUrl) return
      await persist({ avatar: dataUrl })
      toast.success(t('settings.account.avatarSaved'))
    } catch (error) {
      toast.error(t('settings.account.avatarFailed', { message: errorMessage(error) }))
    } finally {
      setChangingAvatar(false)
    }
  }

  const handleRemoveAvatar = async () => {
    try {
      await persist({ avatar: '' })
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: errorMessage(error) }))
    }
  }
  const handleAnalyticsConsentChange = async (checked: boolean) => {
    if (savingAnalyticsConsent) return
    setSavingAnalyticsConsent(true)
    try {
      const next = await window.electronAPI.setGamificationAnalyticsConsent(checked)
      setGamification((prev) => prev ? { ...prev, analyticsConsent: next.analyticsConsent } : prev)
    } catch (error) {
      toast.error(t('settings.accounts.profileSaveFailed', { message: errorMessage(error) }))
    } finally {
      setSavingAnalyticsConsent(false)
    }
  }

  const name = resolveDisplayName(cloudAccount, profile?.displayName, t('profile.defaultName'))
  const plan = profile?.plan ?? 'standard'
  const progressPct = Math.round((gamification?.progress ?? 0) * 100)
  const recent = gamification?.recentEvents ?? []
  // Always-visible defaults: even before the XP service answers (or if it is
  // unavailable) the "Level and XP" block renders a concrete level and total.
  const level = gamification?.level ?? 1
  const lifetimeXp = gamification?.xp ?? 0
  const nextThreshold = gamification?.nextThreshold ?? null
  const dashboard = React.useMemo(() => {
    const workspaceId = workspace?.id
    const remoteWorkspaceId = workspace?.remoteServer?.remoteWorkspaceId
    const sessions = [...sessionMetaMap.values()].filter((session) =>
      isHomeSessionInWorkspace(session, workspaceId, remoteWorkspaceId),
    )
    return buildMiniDashboard({
      sessions,
      tasks: taskCount,
      connection: connectionState,
    })
  }, [sessionMetaMap, workspace, taskCount, connectionState])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title={t('settings.account.title')}
        actions={<HeaderMenu route={routes.view.settings('account')} />}
      />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="mx-auto w-full max-w-5xl space-y-8 px-5 py-7">
            <p className="whitespace-normal break-words text-sm text-muted-foreground">
              {t('settings.account.description')}
            </p>
        <SettingsSection title={t('settings.account.cloud.title')}>
          <SettingsCard>
            <SettingsRow label={cloudAccount?.user.name || cloudAccount?.user.handle || t('profile.defaultName')} description={cloudAccount?.user.email || t('settings.account.cloud.disconnected')}>
              <Button size="sm" variant="outline" onClick={() => { void window.electronAPI.clearRoxCloud().then(() => window.location.reload()).catch(() => toast.error(t('settings.account.cloud.logoutFailed'))) }}>{t('settings.account.cloud.logout')}</Button>
            </SettingsRow>
            <SettingsRow label={t('settings.account.cloud.organization')}><span>{cloudAccount?.organization.name || '—'}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.handle')}><span>{cloudAccount?.user.handle ? `@${cloudAccount.user.handle}` : '—'}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.status')}><span>{cloudUpdating ? t('settings.account.cloud.updating') : cloudError ? t('settings.account.cloud.unavailable') : cloudAccount ? t(`onboarding.roxConnect.${cloudAccount.state}`) : t('settings.account.cloud.disconnected')}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.key')}><span>{cloudAccount?.key?.prefix || '—'}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.available')}><span>{cloudAccount ? `${cloudAccount.balance.availableRox} ROX` : t('settings.account.cloud.disconnected')}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.held')}><span>{cloudAccount ? `${cloudAccount.balance.heldRox} ROX` : '—'}</span></SettingsRow>
            <SettingsRow label={t('settings.account.cloud.synced')}><span>{cloudUpdating ? t('settings.account.cloud.updating') : cloudSyncedAt ? accountSyncTime(cloudSyncedAt, i18n.language) : '—'}</span></SettingsRow>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection title={t('settings.account.usageSection')}>
          <MiniDashboardCards snapshot={dashboard} className="grid-cols-2 sm:grid-cols-3" />
        </SettingsSection>

        <SettingsSection title={t('settings.account.identitySection')}>
          <SettingsCard>
            {profileLoadFailed ? (
              <SettingsRow label={t('settings.account.loadFailed', { message: t('common.failed') })}>
                <Button size="sm" variant="outline" onClick={() => void load()}>{t('common.retry')}</Button>
              </SettingsRow>
            ) : null}
            <SettingsRow label={t('settings.account.avatar')}>
              <div className="flex items-center gap-3">
                <Avatar className="h-14 w-14">
                  {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
                  <AvatarFallback delayMs={0} className="bg-foreground/10">
                    <CraftAgentsSymbol className="h-full w-full" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-2">
                  <Button size="sm" variant="outline" disabled={changingAvatar || saving || !profile} onClick={() => void handleChangeAvatar()}>
                    {t('settings.account.changeAvatar')}
                  </Button>
                  {profile?.avatar ? (
                    <Button size="sm" variant="ghost" disabled={changingAvatar || saving} onClick={() => void handleRemoveAvatar()}>
                      {t('settings.account.removeAvatar')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </SettingsRow>
            <SettingsRow
              label={t('settings.accounts.displayName')}
              description={t('settings.accounts.displayNameHint')}
            >
              <div className="flex items-center gap-2 min-w-[240px]">
                <Input
                  value={displayName}
                  maxLength={80}
                  disabled={saving || !profile}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="h-8"
                  aria-label={t('settings.accounts.displayName')}
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label={t('settings.account.email')}
              description={t('settings.account.mailboxHint', { domain: mailDomain })}
            >
              {mailAddress ? (
                <span
                  className="min-w-0 max-w-[320px] truncate font-mono text-sm"
                  title={mailAddress}
                  data-testid="settings-mail-address"
                >
                  {mailAddress}
                </span>
              ) : (
                <span className="min-w-[240px] text-sm text-muted-foreground" data-testid="settings-mail-pending">
                  {t('settings.account.mailboxPending')}
                </span>
              )}
            </SettingsRow>
            <SettingsCardFooter saved={profileSavedFlash}>
              <Button size="sm" onClick={() => void handleSaveProfile()} disabled={saving || !profile || !displayName.trim()}>
                {t('common.save')}
              </Button>
            </SettingsCardFooter>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('settings.account.planSection')}>
          <SettingsCard>
            {SHOW_PLAN_PICKER ? (
              <SettingsRow
                label={t('settings.account.plan')}
                description={t('settings.account.planHint')}
              >
                <SettingsSegmentedControl
                  size="sm"
                  value={plan}
                  onValueChange={(next) => void handlePlanChange(next)}
                  options={PROFILE_PLANS.map((value) => ({
                    value,
                    label: t(`settings.account.plan.${value}`),
                  }))}
                />
              </SettingsRow>
            ) : null}
            <SettingsRow label={t('profile.balanceLabel')} description={t('settings.account.cloud.title')}>
              <span className="text-sm numeric">{formatBalance(cloudAccount ? Number(cloudAccount.balance.availableRox) : null, t)}</span>
            </SettingsRow>
            <SettingsToggle
              label={t('settings.account.analyticsConsent')}
              description={t('settings.account.analyticsConsentDesc')}
              checked={gamification?.analyticsConsent === true}
              disabled={savingAnalyticsConsent}
              onCheckedChange={(checked) => void handleAnalyticsConsentChange(checked)}
            />
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('settings.account.progressSection')}>
          <SettingsCard>
            <SettingsRow label={t('settings.account.level')}>
              <span className="text-sm">{t('profile.level', { level })}</span>
            </SettingsRow>
            <SettingsRow
              label={t('settings.account.xp')}
              description={t('settings.account.xpHint')}
            >
              <div className="min-w-[220px] space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground numeric">
                  <span>
                    {nextThreshold == null
                      ? t('profile.xpMax', { xp: lifetimeXp })
                      : t('profile.xpProgress', {
                          current: lifetimeXp,
                          next: nextThreshold,
                        })}
                  </span>
                  <span>{progressPct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPct}
                  className="h-1.5 rounded-full bg-foreground/10 overflow-hidden"
                >
                  <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            </SettingsRow>
            <SettingsRow label={t('settings.account.xpSources')}>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>{t('settings.account.source.sessionCompleted')}</li>
                <li>{t('settings.account.source.automationRan')}</li>
                <li>{t('settings.account.source.cloudRunImported')}</li>
                <li>{t('settings.account.source.noteLinked')}</li>
              </ul>
            </SettingsRow>
            <SettingsRow label={t('settings.account.recentXp')}>
              {recent.length === 0 ? (
                <span className="text-sm text-muted-foreground">{t('settings.account.recentXpEmpty')}</span>
              ) : (
                <ul className="grid min-w-[240px] grid-cols-1 gap-x-6 text-xs sm:grid-cols-2">
                  {recent.slice(0, 8).map((event, index) => (
                    <li
                      key={`${event.at}-${index}`}
                      className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <span>{t(XP_EVENT_KEYS[event.type] ?? event.type)}</span>
                      <span className="numeric text-muted-foreground">+{event.xp}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('quests.sectionTitle')}><QuestProgressCard scopeKey={workspace?.id} /></SettingsSection>

        <SettingsSection
          title={t('knowledgeMap.profile.sectionTitle')}
          description={t('knowledgeMap.profile.sectionHint')}
        >
          <KnowledgeMapPanel
            workspaceId={workspace?.id ?? null}
            compact
            onOpenFull={() => navigate(routes.view.settings('context'))}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.accounts.connectionsSection')}>
          <SettingsCard>
            <SettingsRow
              label={name}
              description={t('settings.account.openConnectionsHint')}
            >
              <Button size="sm" variant="outline" onClick={() => navigate(routes.view.settings('accounts'))}>
                {t('settings.account.openConnections')}
              </Button>
            </SettingsRow>
            <SettingsRow
              label={t('settings.privacy.title')}
              description={t('settings.account.openPrivacyHint')}
            >
              <Button size="sm" variant="outline" onClick={() => navigate(routes.view.settings('privacy'))}>
                {t('settings.account.openPrivacy')}
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
