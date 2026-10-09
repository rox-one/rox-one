/**
 * NativeIntegrationsSettingsSection — "System integrations" on the App
 * settings page.
 *
 * Controls the two OS-level integration points the renderer owns:
 * - quick composer (global accelerator on/off + capture)
 * - "launch at login" (login item, with a graceful unsupported state)
 *
 * The preload may not have shipped the frozen channels yet, so every bridge
 * member is optional: unavailable controls are hidden or disabled, never dead.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Keyboard, RotateCcw } from 'lucide-react'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { toast } from 'sonner'
import { acceleratorFromKeyboardEvent, formatAccelerator } from '@/features/native-integrations/accelerator'
import { settingsPageActionAllowed, settingsRuntimeSource } from './settings-rox2-surface'
import {
  DEFAULT_QUICK_COMPOSER_ACCELERATOR,
  nativeIntegrations,
  type LoginItemState,
} from '@/platform/native-integrations'

/** Focusable read-only control that records a global accelerator from a keypress. */
function ShortcutCapture({
  value,
  disabled,
  busy,
  onChange,
  onClear,
}: {
  value: string | null
  disabled: boolean
  busy: boolean
  onChange: (accelerator: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const [capturing, setCapturing] = React.useState(false)
  const display = value ? formatAccelerator(value) : t('settings.nativeIntegrations.notSet')

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={t('settings.nativeIntegrations.quickComposerShortcut')}
        data-testid="native-quick-composer-shortcut"
        data-capturing={capturing || undefined}
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setCapturing(false)
            return
          }
          const accelerator = acceleratorFromKeyboardEvent(event)
          if (!accelerator) return
          event.preventDefault()
          setCapturing(false)
          onChange(accelerator)
        }}
        className="inline-flex min-w-[140px] items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-border/60 bg-surface-input px-3 py-1.5 text-body disabled:opacity-50"
      >
        <Keyboard className="icon-caption text-muted-foreground" aria-hidden="true" />
        {capturing ? t('settings.nativeIntegrations.capturing') : display}
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || busy || !value}
            aria-label={t('settings.nativeIntegrations.resetShortcut')}
            onClick={onClear}
          >
            <RotateCcw className="icon-caption" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('settings.nativeIntegrations.resetShortcut')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function NativeIntegrationsSettingsSection() {
  const { t } = useTranslation()
  const api = React.useMemo(() => nativeIntegrations(), [])
  const [shortcut, setShortcut] = React.useState<string | null>(null)
  const [loginItem, setLoginItem] = React.useState<LoginItemState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  const hasQuickComposer = Boolean(api.quickComposer?.getShortcut && api.quickComposer?.setShortcut)
  const hasLoginItem = Boolean(api.appIntegration?.getLoginItem && api.appIntegration?.setLoginItem)

  // Playground fixtures and non-claimable sources must not reach live IPC.
  const allowed = settingsPageActionAllowed({
    pageId: 'app',
    action: 'pref-write',
    source: settingsRuntimeSource(),
  })

  React.useEffect(() => {
    let active = true
    const readShortcut = api.quickComposer?.getShortcut
    const readLoginItem = api.appIntegration?.getLoginItem
    void (async () => {
      const [nextShortcut, nextLoginItem] = await Promise.all([
        readShortcut ? readShortcut().catch(() => null) : Promise.resolve(null),
        readLoginItem ? readLoginItem().catch(() => null) : Promise.resolve(null),
      ])
      if (!active) return
      setShortcut(nextShortcut)
      setLoginItem(nextLoginItem)
      setLoading(false)
    })()
    return () => { active = false }
  }, [api])

  const applyShortcut = React.useCallback(async (next: string | null) => {
    if (busy || !allowed) return
    setBusy(true)
    // Optimistic flip; a rejected write restores the previous accelerator.
    const previous = shortcut
    setShortcut(next)
    try {
      await api.quickComposer?.setShortcut?.(next)
    } catch {
      setShortcut(previous)
      toast.error(t('settings.nativeIntegrations.shortcutFailed'))
    } finally {
      setBusy(false)
    }
  }, [api, allowed, busy, shortcut, t])

  const applyLoginItem = React.useCallback(async (openAtLogin: boolean) => {
    if (busy || !allowed || !loginItem?.supported) return
    setBusy(true)
    const previous = loginItem
    setLoginItem({ ...loginItem, openAtLogin })
    try {
      await api.appIntegration?.setLoginItem?.({ openAtLogin })
    } catch {
      setLoginItem(previous)
      toast.error(t('settings.nativeIntegrations.loginItemFailed'))
    } finally {
      setBusy(false)
    }
  }, [api, allowed, busy, loginItem, t])

  if (!hasQuickComposer && !hasLoginItem) return null

  const quickComposerEnabled = shortcut !== null

  return (
    <SettingsSection
      title={t('settings.nativeIntegrations.title')}
      description={t('settings.nativeIntegrations.description')}
      data-testid="native-integrations-section"
    >
      <SettingsCard>
        {hasQuickComposer && (
          <>
            <SettingsToggle
              label={t('settings.nativeIntegrations.quickComposer')}
              description={t('settings.nativeIntegrations.quickComposerDesc')}
              checked={quickComposerEnabled}
              disabled={loading || busy || !allowed}
              onCheckedChange={(checked) => void applyShortcut(checked ? (shortcut ?? DEFAULT_QUICK_COMPOSER_ACCELERATOR) : null)}
            />
            <SettingsRow
              label={t('settings.nativeIntegrations.quickComposerShortcut')}
              description={t('settings.nativeIntegrations.quickComposerShortcutDesc')}
              inCard
            >
              <ShortcutCapture
                value={shortcut}
                disabled={loading || !allowed || !quickComposerEnabled}
                busy={busy}
                onChange={(accelerator) => void applyShortcut(accelerator)}
                onClear={() => void applyShortcut(DEFAULT_QUICK_COMPOSER_ACCELERATOR)}
              />
            </SettingsRow>
          </>
        )}
        {hasLoginItem && (
          <SettingsToggle
            label={t('settings.nativeIntegrations.launchAtLogin')}
            description={
              loginItem && !loginItem.supported
                ? t('settings.nativeIntegrations.launchAtLoginUnsupported')
                : t('settings.nativeIntegrations.launchAtLoginDesc')
            }
            checked={Boolean(loginItem?.openAtLogin)}
            disabled={loading || busy || !allowed || !loginItem?.supported}
            onCheckedChange={(checked) => void applyLoginItem(checked)}
          />
        )}
      </SettingsCard>
    </SettingsSection>
  )
}

export default NativeIntegrationsSettingsSection