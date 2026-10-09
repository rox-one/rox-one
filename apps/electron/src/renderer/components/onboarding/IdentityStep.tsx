/**
 * IdentityStep — the first screen of the redesigned first run.
 *
 * Left: the public handle (4–16, `[a-z0-9_-]`) and the organization slug
 * (same alphabet; empty falls back to `username_org`). Both are colour-coded
 * through the coin badges derived from the reward ledger. Once a handle is
 * explicitly `available`, the reserved rox.one addresses appear in small green
 * type with the addresses in bold.
 *
 * Right: the Rox-coin bonuses (+5 username, +5 organization, +15 Telegram,
 * +5 GitHub) — grey until the matching action lands, gold afterwards. The
 * Telegram/GitHub buttons are stubs for this wave: they fire the injected
 * callbacks and show a local "waiting" state.
 *
 * The step is standalone: availability transport, persistence and the reward
 * ledger all arrive through props, so it renders and tests without a preload
 * bridge.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RoxCoinIcon } from './CoinsBurst'
import { StepHeader, ContinueButton } from './primitives'
import { trackLearningEvent } from './learning-curve'
import { createStorageAdapter, rememberLocalProfile } from './first-result-ui'
import { persistOnboardingUsername } from './onboarding-username'
import {
  ONBOARDING_ORGANIZATION_MAX,
  ONBOARDING_USERNAME_MAX,
  ROX_COIN_REWARDS,
  createHandleAvailabilityController,
  createRoxHandleAvailabilityFetcher,
  defaultOnboardingOrganization,
  identityCoinState,
  normalizeHandleInput,
  parseOnboardingOrganization,
  parseOnboardingUsername,
  reservedIdentityAddresses,
  resolveOnboardingOrganization,
  shouldShowReservedBlock,
  type HandleCheckStatus,
  type IdentityCoinState,
  type ReservedIdentityAddresses,
} from './identity-model'

export interface IdentityStepPersistParams {
  username: string
  organization: string
}

export interface IdentityStepProps {
  /** Persist the identity and advance to the questionnaire. */
  onContinue: () => void
  initialUsername?: string
  initialOrganization?: string
  /** Fired on every field edit with the raw current values (parent-owned). */
  onChange?: (value: { username: string; organization: string }) => void
  /** Stub hook-up for the Telegram flow (implemented in a later wave). */
  onLinkTelegram?: () => void
  /** Stub hook-up for the GitHub flow (implemented in a later wave). */
  onLinkGitHub?: () => void
  /** Fired on every settled availability verdict (for the parent's ledger). */
  onAvailabilityChecked?: (handle: string, status: HandleCheckStatus) => void
  /** Reward-ledger-backed coin state; falls back to the local derivation. */
  rewards?: Partial<IdentityCoinState>
  /** Persist transport; defaults to the preload identity API. */
  persistIdentity?: (params: IdentityStepPersistParams) => Promise<void>
  /** Availability transport; defaults to the Rox broker endpoint. */
  fetchAvailability?: (handle: string) => Promise<unknown>
  /** Injected for tests; defaults to the shared debounce. */
  debounceMs?: number
  className?: string
}

function defaultPersistIdentity({ username, organization }: IdentityStepPersistParams): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api) throw new Error('identity-unavailable')
  return persistOnboardingUsername(api, username, {
    publicHandle: username,
    ...(organization ? { organization } : {}),
  }).then(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        rememberLocalProfile(createStorageAdapter(localStorage), username)
      }
    } catch {
      // The local first-result profile is optional; the identity is already saved.
    }
  })
}

/** Small round Rox coin badge: grey until `gold`, gold afterwards. */
export function IdentityCoinBadge({ gold, label }: { gold: boolean; label: string }) {
  return (
    <span
      data-testid="identity-coin-badge"
      data-state={gold ? 'gold' : 'grey'}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
        gold ? 'text-amber-500' : 'text-muted-foreground/50',
      )}
    >
      <RoxCoinIcon className="size-3.5" />
      <span>{label}</span>
    </span>
  )
}

function usernameHint(status: HandleCheckStatus, t: (key: string) => string) {
  switch (status) {
    case 'checking':
      return <p className="text-xs text-muted-foreground">{t('onboarding.identity.checking')}</p>
    case 'available':
      return <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('onboarding.identity.available')}</p>
    case 'taken':
      return <p className="text-xs text-destructive">{t('onboarding.identity.taken')}</p>
    case 'reserved':
      return <p className="text-xs text-destructive">{t('onboarding.identity.reserved')}</p>
    case 'unknown':
      return <p className="text-xs text-muted-foreground">{t('onboarding.identity.unknown')}</p>
    case 'invalid':
      return <p className="text-xs text-destructive">{t('onboarding.identity.invalid')}</p>
    default:
      return <p className="text-xs text-muted-foreground">{t('onboarding.identity.hint')}</p>
  }
}

export function IdentityStep({
  onContinue,
  initialUsername = '',
  initialOrganization = '',
  onChange,
  onLinkTelegram,
  onLinkGitHub,
  onAvailabilityChecked,
  rewards,
  persistIdentity,
  fetchAvailability,
  debounceMs,
  className,
}: IdentityStepProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState(initialUsername)
  const [organization, setOrganization] = useState(initialOrganization)
  const [usernameStatus, setUsernameStatus] = useState<HandleCheckStatus>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [telegramPending, setTelegramPending] = useState(false)
  const [githubPending, setGithubPending] = useState(false)
  const submitInFlight = useRef(false)
  const trackedSaw = useRef(false)
  // The parent may pass a fresh callback each render; the controller must not
  // be rebuilt (and re-probe) because of it.
  const availabilityCheckedRef = useRef(onAvailabilityChecked)
  availabilityCheckedRef.current = onAvailabilityChecked

  const availability = useMemo(
    () => fetchAvailability ?? createRoxHandleAvailabilityFetcher(),
    [fetchAvailability],
  )

  const controller = useMemo(
    () =>
      createHandleAvailabilityController({
        fetchAvailability: availability,
        debounceMs,
        onChange: (handle, status) => {
          setUsernameStatus(status)
          availabilityCheckedRef.current?.(handle, status)
        },
      }),
    [availability, debounceMs],
  )

  useEffect(() => {
    if (trackedSaw.current) return
    trackedSaw.current = true
    trackLearningEvent({ name: 'saw', stepId: 'identity', source: 'human' })
  }, [])

  useEffect(() => () => controller.dispose(), [controller])

  // Re-run the machine whenever the raw field changes.
  useEffect(() => {
    controller.update(username)
  }, [controller, username])

  const parsedUsername = parseOnboardingUsername(username)
  const parsedOrganization = parseOnboardingOrganization(organization)
  const organizationInput = normalizeHandleInput(organization)
  const effectiveOrganization = resolveOnboardingOrganization(username, organization)
  const organizationInvalid = organizationInput.length > 0 && parsedOrganization === null
  const organizationAccepted = effectiveOrganization !== null
  const showReserved = shouldShowReservedBlock(usernameStatus) && parsedUsername !== null && effectiveOrganization !== null
  const addresses: ReservedIdentityAddresses | null =
    showReserved && parsedUsername && effectiveOrganization
      ? reservedIdentityAddresses(parsedUsername, effectiveOrganization)
      : null

  const derivedCoins = identityCoinState({
    usernameStatus,
    organizationAccepted,
    telegramLinked: false,
    githubLinked: false,
  })
  // The parent owns the reward ledger; the local derivation is the fallback.
  const ledgerCoins: IdentityCoinState = {
    username: rewards?.username ?? derivedCoins.username,
    organization: rewards?.organization ?? derivedCoins.organization,
    telegram: rewards?.telegram ?? derivedCoins.telegram,
    github: rewards?.github ?? derivedCoins.github,
  }

  const organizationPlaceholder = parsedUsername
    ? defaultOnboardingOrganization(parsedUsername)
    : t('onboarding.identity.organizationPlaceholder')

  const handleContinue = async () => {
    if (submitInFlight.current || saving) return
    if (!parsedUsername) {
      setError(t('onboarding.identity.invalid'))
      return
    }
    if (usernameStatus === 'taken' || usernameStatus === 'reserved') {
      setError(t('onboarding.identity.taken'))
      return
    }
    if (organizationInvalid) {
      setError(t('onboarding.identity.organizationInvalid'))
      return
    }
    submitInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const persist = persistIdentity ?? defaultPersistIdentity
      await persist({
        username: parsedUsername,
        organization: effectiveOrganization ?? '',
      })
      trackLearningEvent({ name: 'result', stepId: 'identity', source: 'human' })
      onContinue()
    } catch {
      setError(t('onboarding.identity.saveFailed'))
    } finally {
      submitInFlight.current = false
      setSaving(false)
    }
  }

  const markTried = () => {
    trackLearningEvent({ name: 'tried', stepId: 'identity', source: 'human' })
  }

  const continueDisabled =
    saving || !parsedUsername || usernameStatus === 'taken' || usernameStatus === 'reserved' || organizationInvalid

  const rewardRows: Array<{ key: keyof IdentityCoinState; label: string; amount: number }> = [
    { key: 'username', label: t('onboarding.identity.rewards.username'), amount: ROX_COIN_REWARDS.username },
    { key: 'organization', label: t('onboarding.identity.rewards.organization'), amount: ROX_COIN_REWARDS.organization },
    { key: 'telegram', label: t('onboarding.identity.rewards.telegram'), amount: ROX_COIN_REWARDS.telegram },
    { key: 'github', label: t('onboarding.identity.rewards.github'), amount: ROX_COIN_REWARDS.github },
  ]

  return (
    <div
      data-testid="identity-step-root"
      className={cn('mx-auto w-full max-w-3xl px-6 py-8', className)}
    >
      <StepHeader
        title={t('onboarding.identity.title')}
        description={t('onboarding.identity.description')}
      />
      <div data-testid="identity-step" className="mt-6 grid w-full gap-6 text-left md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="identity-username">{t('onboarding.identity.username')}</Label>
              <IdentityCoinBadge
                gold={ledgerCoins.username}
                label={t('onboarding.identity.coins.reward', { count: ROX_COIN_REWARDS.username })}
              />
            </div>
            <Input
              id="identity-username"
              value={username}
              onChange={(event) => {
                markTried()
                setUsername(event.target.value)
                onChange?.({ username: event.target.value, organization })
              }}
              placeholder={t('onboarding.identity.usernamePlaceholder')}
              autoComplete="username"
              maxLength={ONBOARDING_USERNAME_MAX}
              aria-required
              aria-invalid={usernameStatus === 'invalid' || usernameStatus === 'taken' || usernameStatus === 'reserved'}
              className="h-10 rounded-full border-foreground/[0.08] bg-background/40 px-4 shadow-none focus-visible:border-foreground/20 focus-visible:ring-0"
            />
            {usernameHint(usernameStatus, t)}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="identity-organization">{t('onboarding.identity.organization')}</Label>
              <IdentityCoinBadge
                gold={ledgerCoins.organization}
                label={t('onboarding.identity.coins.reward', { count: ROX_COIN_REWARDS.organization })}
              />
            </div>
            <Input
              id="identity-organization"
              value={organization}
              onChange={(event) => {
                markTried()
                setOrganization(event.target.value)
                onChange?.({ username, organization: event.target.value })
              }}
              placeholder={organizationPlaceholder}
              maxLength={ONBOARDING_ORGANIZATION_MAX}
              aria-invalid={organizationInvalid}
              className="h-10 rounded-full border-foreground/[0.08] bg-background/40 px-4 shadow-none focus-visible:border-foreground/20 focus-visible:ring-0"
            />
            {organizationInvalid ? (
              <p className="text-xs text-destructive">{t('onboarding.identity.organizationInvalid')}</p>
            ) : null}
          </div>

          {addresses ? (
            <div
              data-testid="identity-reserved-addresses"
              className="space-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <p>{t('onboarding.identity.reservedUsername')}{' '}<strong className="font-semibold">{addresses.handle}</strong></p>
              <p>{t('onboarding.identity.reservedOrganization')}{' '}<strong className="font-semibold">{addresses.organization}</strong></p>
              <p>{t('onboarding.identity.reservedEmail')}{' '}<strong className="font-semibold">{addresses.email}</strong></p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 gap-2 rounded-full"
              data-testid="identity-link-telegram"
              aria-busy={telegramPending}
              onClick={() => {
                markTried()
                setTelegramPending(true)
                onLinkTelegram?.()
              }}
            >
              {t('onboarding.identity.linkTelegram')}
              <IdentityCoinBadge
                gold={ledgerCoins.telegram}
                label={t('onboarding.identity.coins.reward', { count: ROX_COIN_REWARDS.telegram })}
              />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1 gap-2 rounded-full"
              data-testid="identity-link-github"
              aria-busy={githubPending}
              onClick={() => {
                markTried()
                setGithubPending(true)
                onLinkGitHub?.()
              }}
            >
              {t('onboarding.identity.linkGitHub')}
              <IdentityCoinBadge
                gold={ledgerCoins.github}
                label={t('onboarding.identity.coins.reward', { count: ROX_COIN_REWARDS.github })}
              />
            </Button>
          </div>

          {telegramPending || githubPending ? (
            <p role="status" className="text-xs text-muted-foreground" data-testid="identity-linking">
              {t('onboarding.identity.linking')}
            </p>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <aside data-testid="identity-rewards" className="space-y-2 self-start rounded-xl border border-border/60 bg-background/30 p-3">
          <h3 className="text-sm font-semibold">{t('onboarding.identity.rewards.title')}</h3>
          <ul className="space-y-2">
            {rewardRows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <IdentityCoinBadge
                  gold={ledgerCoins[row.key]}
                  label={t('onboarding.identity.coins.reward', { count: row.amount })}
                />
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="mt-8 flex justify-center">
        <ContinueButton
          onClick={() => void handleContinue()}
          className="w-full max-w-[320px]"
          disabled={continueDisabled}
          loading={saving}
          data-testid="identity-continue"
        >
          {t('onboarding.identity.continue')}
        </ContinueButton>
      </div>
    </div>
  )
}