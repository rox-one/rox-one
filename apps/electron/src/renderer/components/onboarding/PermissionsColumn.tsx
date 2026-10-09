import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  PermissionId,
  PermissionPlatform,
  PermissionState,
  GrantStatus,
} from './permissions-model'
import {
  canToggle,
  entriesForPlatform,
  initialPermissionsState,
  isEnabled,
  permissionStatus,
  setPermissionEnabled,
} from './permissions-model'

export { isPermissionsColumnComplete } from './permissions-model'

/**
 * Right-hand onboarding column — permissions & modes.
 *
 * Standalone: every native/Electron interaction arrives through props
 * (`onRequestGrant`, `onNotifyBlocked`), so the column renders and tests
 * without a preload bridge. The wizard owns wiring it to the host.
 */
export interface PermissionsColumnProps {
  /** Runtime the column is rendered for. Defaults to macOS. */
  platform?: PermissionPlatform
  /** Controlled state; omit for internal (uncontrolled) state. */
  state?: PermissionState
  /** Seed grant statuses when running uncontrolled. */
  defaultGrants?: Partial<Record<PermissionId, GrantStatus>>
  /** Fired whenever a toggle changes (controlled and uncontrolled). */
  onStateChange?: (state: PermissionState) => void
  /** Fired by «Выдать»; native grant wiring lives outside this component. */
  onRequestGrant?: (id: PermissionId) => void
  /** Fired when a blocked row is clicked. Falls back to a toast. */
  onNotifyBlocked?: (id: PermissionId) => void
  className?: string
}

const STATUS_CHIP: Record<GrantStatus, string> = {
  granted: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  denied: 'border-destructive/30 bg-destructive/10 text-destructive',
  'not-determined': 'border-border/60 bg-foreground/5 text-muted-foreground',
}

const STATUS_KEY: Record<GrantStatus, string> = {
  granted: 'granted',
  denied: 'denied',
  'not-determined': 'notDetermined',
}

export function PermissionsColumn({
  platform = 'mac',
  state,
  defaultGrants,
  onStateChange,
  onRequestGrant,
  onNotifyBlocked,
  className,
}: PermissionsColumnProps) {
  const { t } = useTranslation()
  const [internal, setInternal] = useState<PermissionState>(() =>
    initialPermissionsState(platform, defaultGrants),
  )
  // Controlled when the caller passes `state`, otherwise internal.
  const current = state ?? internal

  const commit = (next: PermissionState) => {
    if (!state) setInternal(next)
    onStateChange?.(next)
  }

  const notifyBlocked = (id: PermissionId) => {
    if (onNotifyBlocked) {
      onNotifyBlocked(id)
      return
    }
    const entry = entriesForPlatform(current.platform).find((candidate) => candidate.id === id)
    if (!entry) return
    const decision = canToggle(entry, current)
    const dependency = entry.dependsOn
    toast(t(decision.reasonKey ?? 'onboarding.permissions.blocked.fullDiskAccess'), {
      action: decision.actionKey && dependency
        ? { label: t(decision.actionKey), onClick: () => onRequestGrant?.(dependency) }
        : undefined,
    })
  }

  return (
    <div
      data-testid="permissions-column"
      data-platform={current.platform}
      className={cn('flex flex-col gap-3 text-left', className)}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{t('onboarding.permissions.title')}</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('onboarding.permissions.subtitle')}
      </p>

      <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--radius-card)] border border-border/60 bg-background/30">
        {entriesForPlatform(current.platform).map((entry) => {
          const decision = canToggle(entry, current)
          const checked = isEnabled(entry, current)
          const status = permissionStatus(entry, current)
          const title = t(`onboarding.permissions.items.${entry.id}.title`)
          const canGrant = entry.grantKind === 'tcc' && status !== 'granted'

          return (
            <div
              key={entry.id}
              data-testid={`permission-row-${entry.id}`}
              data-blocked={decision.blocked ? 'true' : undefined}
              role={decision.blocked ? 'button' : undefined}
              aria-disabled={decision.blocked ? true : undefined}
              title={decision.blocked && decision.reasonKey ? t(decision.reasonKey) : undefined}
              onClick={decision.blocked ? () => notifyBlocked(entry.id) : undefined}
              className={cn(
                'flex items-start gap-3 px-3 py-3 transition-colors motion-reduce:transition-none',
                decision.blocked && 'cursor-not-allowed bg-foreground/[0.02] opacity-60',
              )}
            >
              <Switch
                checked={checked}
                disabled={decision.blocked}
                onCheckedChange={(value) => commit(setPermissionEnabled(current, entry.id, value))}
                aria-label={title}
                data-testid={`permission-switch-${entry.id}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{title}</span>
                  <Badge
                    variant="outline"
                    data-testid={`permission-status-${entry.id}`}
                    className={cn('px-1.5 py-0 text-[10px] font-medium', STATUS_CHIP[status])}
                  >
                    {t(`onboarding.permissions.status.${STATUS_KEY[status]}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t(`onboarding.permissions.items.${entry.id}.description`)}
                </p>
                {canGrant ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-6 rounded-full px-2.5 text-[11px]"
                    data-testid={`permission-grant-${entry.id}`}
                    onClick={() => onRequestGrant?.(entry.id)}
                  >
                    {t('onboarding.permissions.grant')}
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}