import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Globe2, ShieldCheck } from 'lucide-react'
import { answerChoice, type BrowserImportCategory } from '@craft-agent/shared/environment'
import { Button } from '@/components/ui/button'
import { BrowserImportPreferences } from './BrowserImportPreferences'

/** First launch records preferences without discovering profiles or requesting a native grant. */
export function WelcomeBrowserImportPreferences({ onSavingChange }: { onSavingChange: (saving: boolean) => void }) {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(false)
  const [categories, setCategories] = useState<BrowserImportCategory[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<'load' | 'save' | null>(null)
  const generation = useRef(0)
  const saveInFlight = useRef(false)
  const retrySelection = useRef<BrowserImportCategory[] | null>(null)

  const load = async (request: number) => {
    setLoading(true)
    setFailed(null)
    try {
      const { prefs } = await window.electronAPI.getEnvironmentSetup()
      if (request === generation.current) setCategories(prefs.browserImport.value ?? [])
    } catch {
      if (request === generation.current) setFailed('load')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }

  useEffect(() => {
    const request = ++generation.current
    // Browser data preferences belong to this desktop, rather than a remote host.
    try {
      if (window.electronAPI?.getRuntimeEnvironment?.() === 'electron') {
        setAvailable(true)
        void load(request)
      }
    } catch { /* A missing desktop transport leaves the username setup available. */ }
    return () => { generation.current = request + 1 }
  }, [])

  const save = async (next: BrowserImportCategory[]) => {
    if (saveInFlight.current || categories === null) return
    const request = generation.current
    const previous = categories
    saveInFlight.current = true
    retrySelection.current = next
    setCategories(next)
    setSaving(true)
    setFailed(null)
    onSavingChange(true)
    try {
      const { prefs } = await window.electronAPI.saveEnvironmentSetup({ browserImport: answerChoice(next) })
      if (request === generation.current) {
        setCategories(prefs.browserImport.value ?? [])
        retrySelection.current = null
      }
    } catch {
      if (request === generation.current) {
        setCategories(previous)
        setFailed('save')
      }
    } finally {
      saveInFlight.current = false
      if (request === generation.current) {
        setSaving(false)
        onSavingChange(false)
      }
    }
  }

  if (!available) return null

  return (
    <details className="group mt-5 rounded-2xl border border-border/60 bg-background/40 text-left" data-testid="welcome-browser-import-preferences">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Globe2 className="size-4 text-sky-500" aria-hidden="true" />
        {t('onboarding.environment.browserImport')}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="space-y-3 px-4 pb-4" aria-busy={loading || saving}>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.browserImport.preferencesHint')}</p>
        {categories ? <BrowserImportPreferences selected={categories} onChange={(next) => void save(next)} disabled={loading || saving} /> : null}
        {loading ? <p role="status" className="text-xs text-muted-foreground">{t('common.loading')}</p> : null}
        {failed ? <div className="flex items-center justify-between gap-2">
          <p role="alert" className="text-xs text-destructive">{t(failed === 'save' ? 'onboarding.welcome.browserImportSaveFailed' : 'common.errorLoadingContent')}</p>
          <Button type="button" size="sm" variant="ghost" disabled={loading || saving} onClick={() => {
            if (failed === 'save' && retrySelection.current) void save(retrySelection.current)
            else void load(generation.current)
          }}>{t('common.retry')}</Button>
        </div> : null}
        <div className="flex items-start gap-2 rounded-xl bg-foreground/5 p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">{t('onboarding.welcome.browserImportPermissionHint')}</p>
        </div>
      </div>
    </details>
  )
}
