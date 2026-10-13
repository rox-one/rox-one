import * as React from 'react'
import { useTourTarget } from '@/features/product-tour/runtime/hooks'

import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { isWebUI } from '@/lib/platform'
import {
  PERMISSION_MODE_CONFIG,
  PERMISSION_MODE_ORDER,
  type PermissionMode,
} from '@rox/shared/agent/modes'

// ============================================================================
// Mode Icon (same SVG pattern as ActiveOptionBadges.PermissionModeIcon)
// ============================================================================

function ModeIcon({ mode, className }: { mode: PermissionMode; className?: string }) {
  const config = PERMISSION_MODE_CONFIG[mode]
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={config.svgPath} />
    </svg>
  )
}

const MODE_STYLES: Record<PermissionMode, { className: string }> = {
  safe: { className: 'text-foreground/60' },
  ask: { className: 'text-foreground/70' },
  'allow-all': { className: 'text-foreground/80' },
}

// Localized labels for each mode (PERMISSION_MODE_CONFIG carries English-only
// displayName/shortName/description — render via these keys instead).
const MODE_LABEL_KEYS: Record<PermissionMode, { name: string; short: string; desc: string }> = {
  'safe': { name: 'mode.explore', short: 'mode.exploreShort', desc: 'mode.exploreFullDesc' },
  'ask': { name: 'mode.askToEdit', short: 'mode.askToEditShort', desc: 'mode.askFullDesc' },
  'allow-all': { name: 'mode.execute', short: 'mode.executeShort', desc: 'mode.executeFullDesc' },
}

// ============================================================================
// Component
// ============================================================================

interface CompactPermissionModeSelectorProps {
  permissionMode: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /**
   * `deck` shrinks the trigger to the 28 px composer-deck chip value slot
   * (`--text-caption`, token hover only). Default preserves the compact
   * composer geometry unchanged.
   */
  variant?: 'default' | 'deck'
}

export function CompactPermissionModeSelector({
  permissionMode,
  onPermissionModeChange,
  variant = 'default',
}: CompactPermissionModeSelectorProps) {
  const { t } = useTranslation()
  const permissionsTarget = useTourTarget('composer.permissions', { variant: 'compact' })
  const [open, setOpen] = React.useState(false)

  const handleSelect = React.useCallback((mode: PermissionMode) => {
    onPermissionModeChange?.(mode)
    setOpen(false)
  }, [onPermissionModeChange])

  const style = MODE_STYLES[permissionMode]

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          ref={permissionsTarget}
          type="button"
          aria-label={`${t('mode.permissionMode')}: ${t(MODE_LABEL_KEYS[permissionMode].name)}`}
          title={`${t('mode.permissionMode')}: ${t(MODE_LABEL_KEYS[permissionMode].name)}`}
          className={cn(
            "input-toolbar-btn focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
            variant === 'deck'
              ? "min-h-[28px] gap-1 rounded-[var(--radius-control)] flex items-center px-0.5 text-caption font-medium text-text-primary outline-none select-none shrink-0 hover:bg-surface-hover transition-colors duration-[var(--motion-fast)]"
              : isWebUI
                ? "min-h-[var(--control-md)] min-w-[var(--control-md)] p-0 text-xs font-medium rounded-[var(--radius-control)] flex items-center justify-center outline-none select-none shrink-0 text-foreground/70 hover:bg-foreground/5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]"
                : "min-h-[var(--control-md)] pl-2 pr-2.5 text-xs font-medium rounded-[var(--radius-control)] flex items-center gap-1.5 outline-none select-none shrink-0 hover:bg-foreground/5",
            variant === 'default' && !isWebUI && style.className,
          )}
        >
          <ModeIcon mode={permissionMode} className="h-3.5 w-3.5" />
          {variant === 'deck'
            ? <span>{t(MODE_LABEL_KEYS[permissionMode].name)}</span>
            : !isWebUI && <span>{t(MODE_LABEL_KEYS[permissionMode].short)}</span>}
        </button>
      </DrawerTrigger>

      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('mode.permissionMode')}</DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-6 flex flex-col gap-1">
          {PERMISSION_MODE_ORDER.map((mode) => {
            const isSelected = mode === permissionMode
            return (
              <DrawerClose asChild key={mode}>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-3 rounded-lg text-left transition-colors",
                    isSelected ? "bg-foreground/5" : "hover:bg-foreground/5",
                  )}
                  onClick={() => handleSelect(mode)}
                >
                  <span className={cn("shrink-0", PERMISSION_MODE_CONFIG[mode].colorClass.text)}>
                    <ModeIcon mode={mode} className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t(MODE_LABEL_KEYS[mode].name)}</div>
                    <div className="text-xs text-muted-foreground">{t(MODE_LABEL_KEYS[mode].desc)}</div>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-foreground/60" />
                  )}
                </button>
              </DrawerClose>
            )
          })}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
