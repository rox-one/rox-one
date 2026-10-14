import { useId, useState } from 'react'
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
 * Compact rows: switch, title + status badge, a one-line description (full
 * text in the tooltip and as the switch's accessible description) and the
 * «Выдать» action inline on the right.
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
  granted: 'border-status-success/30 bg-status-success/10 text-success',
  denied: 'border-destructive/30 bg-destructive/10 text-destructive',
  'not-determined': 'border-border/60 bg-surface-hover text-muted-foreground',
  unsupported: 'border-border/60 bg-surface-hover text-muted-foreground',
}

const STATUS_KEY: Record<GrantStatus, string> = {
  granted: 'granted',
  denied: 'denied',
  'not-determined': 'notDetermined',
  unsupported: 'unsupported',
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
  const idBase = useId()
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
        <ShieldCheck className="icon-toolbar shrink-0 text-success" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{t('onboarding.permissions.title')}</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('onboarding.permissions.subtitle')}
      </p>

      <div className="divide-y divide-border/60 overflow-hidden rounded-[var(--radius-card)] border border-border/60 bg-background/30">
        {entriesForPlatform(current.platform).map((entry) => {
          const decision = canToggle(entry, current)
          const checked = isEnabled(entry, current)
          const status = permissionStatus(entry, current)
          const title = t(`onboarding.permissions.items.${entry.id}.title`)
          const description = t(`onboarding.permissions.items.${entry.id}.description`)
          const descriptionId = `${idBase}-${entry.id}-description`
          const canGrant =
            entry.grantKind === 'tcc' && status !== 'granted' && status !== 'unsupported'

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
                'flex items-center gap-2.5 px-3 py-2 transition-colors motion-reduce:transition-none',
                decision.blocked && 'cursor-not-allowed bg-foreground-2 opacity-60',
              )}
            >
              <Switch
                checked={checked}
                disabled={decision.blocked}
                onCheckedChange={(value) => commit(setPermissionEnabled(current, entry.id, value))}
                aria-label={title}
                aria-describedby={descriptionId}
                data-testid={`permission-switch-${entry.id}`}
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-body font-medium" title={title}>{title}</span>
                  <Badge
                    variant="outline"
                    data-testid={`permission-status-${entry.id}`}
                    className={cn('shrink-0 rounded-full px-1.5 py-0 text-caption font-medium', STATUS_CHIP[status])}
                  >
                    {t(`onboarding.permissions.status.${STATUS_KEY[status]}`)}
                  </Badge>
                </div>
                <p
                  id={descriptionId}
                  className="truncate text-xs text-muted-foreground"
                  title={description}
                >
                  {description}
                </p>
              </div>
              {canGrant ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 rounded-full px-2.5 text-caption"
                  data-testid={`permission-grant-${entry.id}`}
                  onClick={() => onRequestGrant?.(entry.id)}
                >
                  {t('onboarding.permissions.grant')}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}