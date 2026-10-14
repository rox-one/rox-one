/**
 * Settings → Developers → Performance and Error log (top-50 #49).
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSegmentedControl } from '@/components/settings'
import { clearErrorJournal, formatJournal, useErrorJournal } from '@/lib/error-journal'
import { setLitePreference, useLiteActive, useLitePreference, type LitePreference } from '@/lib/lite-mode'

const VISIBLE = 10

export function DiagnosticsSettings() {
  const { t, i18n } = useTranslation()
  const entries = useErrorJournal()
  const lite = useLitePreference()
  const liteActive = useLiteActive()
  const recent = React.useMemo(() => entries.slice(-VISIBLE).reverse(), [entries])
  const time = React.useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }), [i18n.language])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatJournal(entries))
      toast.success(t('settings.diagnostics.copied'))
    } catch {
      toast.error(t('settings.diagnostics.copyFailed'))
    }
  }

  return (
    <>
      <SettingsSection title={t('settings.diagnostics.performance')}>
        <SettingsCard>
          <SettingsRow
            label={t('settings.diagnostics.lite')}
            description={liteActive ? t('settings.diagnostics.liteDescOn') : t('settings.diagnostics.liteDesc')}
          >
            <SettingsSegmentedControl<LitePreference>
              value={lite}
              onValueChange={setLitePreference}
              options={[
                { value: 'auto', label: t('settings.diagnostics.liteAuto') },
                { value: 'on', label: t('settings.diagnostics.liteOn') },
                { value: 'off', label: t('settings.diagnostics.liteOff') },
              ]}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('settings.diagnostics.errorLog')}>
        <SettingsCard>
          <div className="flex items-center gap-2 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-text-secondary">
              {entries.length === 0 ? t('settings.diagnostics.empty') : t('settings.diagnostics.count', { count: entries.length })}
            </p>
            <button type="button" disabled={entries.length === 0} onClick={() => void copy()} className="rounded-[var(--radius-control)] px-2 py-1 text-sm hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50">
              {t('settings.diagnostics.copy')}
            </button>
            <button type="button" disabled={entries.length === 0} onClick={clearErrorJournal} className="rounded-[var(--radius-control)] px-2 py-1 text-sm text-destructive hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50">
              {t('settings.diagnostics.clear')}
            </button>
          </div>
          {recent.length > 0 && (
            <ol className="max-h-80 overflow-auto border-t border-border-subtle" aria-label={t('settings.diagnostics.errorLog')}>
              {recent.map((entry, index) => (
                <li key={`${entry.at}-${index}`} className="border-b border-border-subtle px-4 py-2 last:border-b-0">
                  <p className="text-xs text-text-muted">
                    <time dateTime={new Date(entry.at).toISOString()}>{time.format(entry.at)}</time>
                    {' · '}{entry.kind === 'error' ? t('settings.diagnostics.kindError') : t('settings.diagnostics.kindRejection')}
                    {entry.route ? ` · ${entry.route}` : ''}
                  </p>
                  <p className="break-words font-mono text-xs text-foreground">{entry.message}</p>
                </li>
              ))}
            </ol>
          )}
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
