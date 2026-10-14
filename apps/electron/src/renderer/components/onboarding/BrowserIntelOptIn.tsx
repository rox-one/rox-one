import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserIntelState } from '@rox/browser-intel'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { GlowTile, PersonalizationArt } from './brand-icons'

/**
 * Renderer surface of the Browser Intelligence bridge.
 *
 * Declared locally instead of on `ElectronAPI` so this step compiles against a
 * preload that has not shipped the channels yet; every member is optional and
 * the component degrades to nothing without them.
 */
interface BrowserIntelBridge {
  getBrowserIntelState?: () => Promise<BrowserIntelState>
  setBrowserIntelConsent?: (consent: boolean) => Promise<unknown>
}

function bridge(): BrowserIntelBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api: unknown = window.electronAPI
  if (typeof api !== 'object' || api === null) return undefined
  // Each channel is probed and runtime-checked before the signature cast.
  const getBrowserIntelState = 'getBrowserIntelState' in api && typeof api.getBrowserIntelState === 'function'
    ? (api.getBrowserIntelState as () => Promise<BrowserIntelState>)
    : undefined
  const setBrowserIntelConsent = 'setBrowserIntelConsent' in api && typeof api.setBrowserIntelConsent === 'function'
    ? (api.setBrowserIntelConsent as (consent: boolean) => Promise<unknown>)
    : undefined
  return { getBrowserIntelState, setBrowserIntelConsent }
}

/**
 * Opt-in consent for deep context personalization. Writes are optimistic: the
 * checkbox flips immediately, then rolls back with a retry affordance when the
 * bridge rejects. `onSavingChange` lets the wizard gate its primary action
 * while a write is in flight.
 */
export function BrowserIntelOptIn({
  onSavingChange,
  className,
}: {
  onSavingChange?: (saving: boolean) => void
  className?: string
} = {}) {
  const { t } = useTranslation()
  const [consent, setConsent] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const savingRef = useRef(false)
  // Retry re-sends the value the user last chose, not the rolled-back one.
  const retryRef = useRef<boolean | null>(null)

  useEffect(() => {
    const api = bridge()
    if (!api?.getBrowserIntelState) return
    const request = ++generation.current
    void api.getBrowserIntelState()
      .then((state) => { if (request === generation.current) setConsent(state.consent) })
      .catch(() => { if (request === generation.current) setFailed(true) })
    return () => { generation.current = request + 1 }
  }, [])

  const apply = async (next: boolean) => {
    const api = bridge()
    if (!api?.setBrowserIntelConsent || savingRef.current) return
    const request = generation.current
    const previous = consent ?? false
    savingRef.current = true
    retryRef.current = next
    setConsent(next)
    setSaving(true)
    setFailed(false)
    onSavingChange?.(true)
    try {
      await api.setBrowserIntelConsent(next)
      if (request === generation.current) retryRef.current = null
    } catch {
      if (request === generation.current) {
        setConsent(previous)
        setFailed(true)
      }
    } finally {
      savingRef.current = false
      if (request === generation.current) {
        setSaving(false)
        onSavingChange?.(false)
      }
    }
  }

  if (!bridge()?.getBrowserIntelState) return null

  const checked = consent ?? false

  return (
    <div className={cn('space-y-2 text-left', className)} data-testid="browser-intel-opt-in">
      <label
        data-selected={checked ? 'true' : 'false'}
        className={cn('onb-glass onb-select flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border py-1.5 pl-1.5 pr-3 text-sm transition-colors motion-reduce:transition-none',
          checked ? 'border-accent/60 bg-accent/5' : 'border-border-strong bg-surface-input hover:bg-surface-hover')}>
        <GlowTile tone="violet"><PersonalizationArt className="size-[26px]" /></GlowTile>
        <span className="min-w-0 flex-1">{t('onboarding.browserIntel.enable')}</span>
        <input
          type="checkbox"
          className="onb-check-input peer sr-only"
          checked={checked}
          disabled={saving}
          onChange={() => void apply(!checked)}
        />
        <span aria-hidden="true" className="onb-check" data-checked={checked ? 'true' : 'false'}>
          <svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 3 6-6.6" /></svg>
        </span>
      </label>
      <p className="onb-helper px-1 text-xs text-muted-foreground">{t('onboarding.browserIntel.description')}</p>
      <p className="onb-helper px-1 text-xs text-muted-foreground">{t('onboarding.browserIntel.storage')}</p>
      {failed ? (
        <div className="flex items-center justify-between gap-2">
          <p role="alert" className="text-xs text-destructive">{t('onboarding.browserIntel.savingError')}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => { if (retryRef.current !== null) void apply(retryRef.current) }}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}