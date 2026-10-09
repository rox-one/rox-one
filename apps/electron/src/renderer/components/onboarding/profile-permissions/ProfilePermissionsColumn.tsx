/**
 * Onboarding right column: permissions & data access.
 *
 * Rows pair a title/one-line explanation with a toggle and, for OS-mediated
 * permissions, an honest status chip. OS rows are never user-authored: their
 * checked state mirrors the probed status and a click opens the matching
 * System Settings pane. Values flow exclusively through `onChange` — the parent
 * owns persistence, this component owns none.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, CircleHelp, MinusCircle, Settings2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  PERMISSION_ROWS,
  canOpenPermissionSettings,
  isOsPermission,
  mergePermissionStatuses,
  permissionValuesEqual,
  type PermissionKey,
  type PermissionSettingsResult,
  type PermissionStatus,
  type PermissionStatuses,
  type PermissionStatusSnapshot,
  type PermissionValues,
} from './permission-model'

export type { PermissionKey, PermissionValues } from './permission-model'

/**
 * Declared locally, like the sibling browser-intel opt-in: every member is
 * optional and the component degrades to honest `unknown` statuses against a
 * preload that has not shipped the channels yet.
 */
interface PermissionsBridge {
  getOnboardingPermissionsStatus?: () => Promise<PermissionStatusSnapshot>
  openOnboardingPermissionSettings?: (key: PermissionKey) => Promise<PermissionSettingsResult>
}

function permissionsBridge(): PermissionsBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api: unknown = window.electronAPI
  if (typeof api !== 'object' || api === null) return undefined
  const record = api as Record<string, unknown>
  return {
    getOnboardingPermissionsStatus:
      typeof record.getOnboardingPermissionsStatus === 'function'
        ? (record.getOnboardingPermissionsStatus as PermissionsBridge['getOnboardingPermissionsStatus'])
        : undefined,
    openOnboardingPermissionSettings:
      typeof record.openOnboardingPermissionSettings === 'function'
        ? (record.openOnboardingPermissionSettings as PermissionsBridge['openOnboardingPermissionSettings'])
        : undefined,
  }
}

const STATUS_ICON: Record<PermissionStatus, typeof Check> = {
  granted: Check,
  denied: X,
  unknown: CircleHelp,
  unsupported: MinusCircle,
}

const STATUS_CLASS: Record<PermissionStatus, string> = {
  granted: 'text-success',
  denied: 'text-destructive',
  unknown: 'text-muted-foreground',
  unsupported: 'text-muted-foreground',
}

function PermissionStatusChip({ rowKey, status }: { rowKey: PermissionKey; status: PermissionStatus }) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[status]
  return (
    <span
      data-testid={`permission-chip-${rowKey}`}
      data-status={status}
      className={cn('inline-flex items-center gap-1 text-xs', STATUS_CLASS[status])}
    >
      <Icon className="icon-caption" aria-hidden="true" />
      {t(`onboarding.permissions.status.${status}`)}
    </span>
  )
}

export function ProfilePermissionsColumn({
  value,
  onChange,
}: {
  value: PermissionValues
  onChange: (next: PermissionValues) => void
}) {
  const { t } = useTranslation()
  const [statuses, setStatuses] = useState<PermissionStatuses>({})
  const [blockedNotice, setBlockedNotice] = useState(false)
  const [openFailure, setOpenFailure] = useState<{ key: PermissionKey; hint: string } | null>(null)
  const [highlighted, setHighlighted] = useState<PermissionKey | null>(null)
  const rowRefs = useRef<Partial<Record<PermissionKey, HTMLDivElement | null>>>({})
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Hydrate OS rows from the real host status exactly once; unknown/unsupported
  // statuses are left at the honest `false` default.
  useEffect(() => {
    const api = permissionsBridge()
    if (!api?.getOnboardingPermissionsStatus) return
    let cancelled = false
    void api
      .getOnboardingPermissionsStatus()
      .then((snapshot) => {
        if (cancelled) return
        const probed = snapshot?.statuses ?? {}
        setStatuses(probed)
        const merged = mergePermissionStatuses(valueRef.current, probed)
        if (!permissionValuesEqual(merged, valueRef.current)) onChangeRef.current(merged)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const openSettings = useCallback(async (key: PermissionKey) => {
    const api = permissionsBridge()
    let result: PermissionSettingsResult
    try {
      result = api?.openOnboardingPermissionSettings
        ? await api.openOnboardingPermissionSettings(key)
        : { opened: false, hint: 'unsupported' }
    } catch {
      result = { opened: false, hint: 'open-failed' }
    }
    setOpenFailure(result.opened ? null : { key, hint: result.hint ?? 'open-failed' })
  }, [])

  const toggle = (key: PermissionKey, next: boolean) => {
    if (isOsPermission(key)) {
      // OS rows reflect the real grant; flipping them opens System Settings.
      void openSettings(key)
      return
    }
    if (key === 'installedAppsInfo' && !value.fullDiskAccess) {
      setBlockedNotice(true)
      return
    }
    setBlockedNotice(false)
    onChange({ ...value, [key]: next })
  }

  const revealDiskAccess = () => {
    setBlockedNotice(false)
    setHighlighted('fullDiskAccess')
    rowRefs.current.fullDiskAccess?.scrollIntoView?.({ block: 'center' })
  }

  useEffect(() => {
    if (!highlighted) return
    const timer = setTimeout(() => setHighlighted(null), 2500)
    return () => clearTimeout(timer)
  }, [highlighted])

  return (
    <section
      data-testid="profile-permissions-column"
      aria-label={t('onboarding.permissions.title')}
      className="flex flex-col gap-1"
    >
      <header className="mb-2">
        <h3 className="text-sm font-medium text-foreground">{t('onboarding.permissions.title')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('onboarding.permissions.subtitle')}</p>
      </header>

      {PERMISSION_ROWS.map((key) => {
        const os = isOsPermission(key)
        const status: PermissionStatus | undefined = os ? statuses[key] ?? 'unknown' : statuses[key]
        const installedAppsBlocked = key === 'installedAppsInfo' && !value.fullDiskAccess
        return (
          <div
            key={key}
            ref={(el) => {
              rowRefs.current[key] = el
            }}
            data-testid={`permission-row-${key}`}
            data-os={os ? 'true' : undefined}
            data-highlighted={highlighted === key ? 'true' : undefined}
            className={cn(
              'flex items-start gap-3 rounded-md px-2 py-2 transition-colors',
              highlighted === key && 'bg-accent/10 ring-1 ring-accent/40',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground">{t(`onboarding.permissions.row.${key}.title`)}</span>
                {status ? <PermissionStatusChip rowKey={key} status={status} /> : null}
                {os && canOpenPermissionSettings(status) ? (
                  <button
                    type="button"
                    data-testid={`permission-open-${key}`}
                    onClick={() => { void openSettings(key) }}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <Settings2 className="icon-status" aria-hidden="true" />
                    {t('onboarding.permissions.open')}
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(`onboarding.permissions.row.${key}.description`)}
              </p>

              {openFailure?.key === key ? (
                <p data-testid={`permission-open-failure-${key}`} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="icon-status" aria-hidden="true" />
                  {t(`onboarding.permissions.openHint.${openFailure.hint}`)}
                </p>
              ) : null}

              {key === 'installedAppsInfo' && blockedNotice && !value.fullDiskAccess ? (
                <div
                  data-testid="permission-installed-apps-notice"
                  className="mt-1.5 flex items-center gap-2 rounded border border-border bg-muted/40 px-2 py-1.5"
                >
                  <AlertTriangle className="icon-caption shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground">
                    {t('onboarding.permissions.installedApps.blocked')}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    data-testid="permission-installed-apps-fix"
                    onClick={revealDiskAccess}
                  >
                    {t('onboarding.permissions.installedApps.fix')}
                  </Button>
                </div>
              ) : null}
            </div>

            <Switch
              data-testid={`permission-switch-${key}`}
              checked={value[key]}
              aria-disabled={os || installedAppsBlocked}
              className={cn((os || installedAppsBlocked) && 'cursor-not-allowed opacity-60')}
              onCheckedChange={(next) => toggle(key, next)}
            />
          </div>
        )
      })}
    </section>
  )
}