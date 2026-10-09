/**
 * Rox History settings dialog: capture toggles, retention, entry cap, the
 * sensitive-content guard and the (persisted, not registered here) global
 * shortcut. Values are saved explicitly through `saveClipboardSettings`.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ClipSettings } from '@rox/shared/clipboard-history'
import { Button } from '@/components/mode-screen/ModeScreen'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const RETENTION_OPTIONS: ReadonlyArray<{ days: number; key: string }> = [
  { days: 1, key: 'clipboard.settings.retention.1d' },
  { days: 7, key: 'clipboard.settings.retention.7d' },
  { days: 30, key: 'clipboard.settings.retention.30d' },
  { days: 180, key: 'clipboard.settings.retention.180d' },
]

const ROW = 'flex items-start justify-between gap-3 py-1.5'
const HINT = 'text-[11px] text-text-muted'
const INPUT = 'h-7 rounded-[var(--radius-card)] bg-foreground/[0.05] px-2 text-[12px] outline-none placeholder:text-text-muted focus:bg-foreground/[0.08]'

function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-0.5 size-3.5 shrink-0 accent-[var(--accent)]"
    />
  )
}

export function ClipboardHistorySettings({
  open,
  onOpenChange,
  settings,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: ClipSettings | null
  saving: boolean
  onSave: (patch: Partial<ClipSettings>) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = React.useState<ClipSettings | null>(settings)

  React.useEffect(() => { if (open) setDraft(settings) }, [open, settings])
  if (!draft) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="clipboard-settings">
          <DialogHeader><DialogTitle>{t('clipboard.settings.title')}</DialogTitle></DialogHeader>
          <p className="text-small text-text-muted">{t('clipboard.unavailable')}</p>
        </DialogContent>
      </Dialog>
    )
  }

  const patch = (next: Partial<ClipSettings>) => setDraft((current) => (current ? { ...current, ...next } : current))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="clipboard-settings" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('clipboard.settings.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          <label className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.captureEnabled')}</span>
              <span className={HINT}>{t('clipboard.settings.captureEnabledHint')}</span>
            </span>
            <Check checked={draft.captureEnabled} label={t('clipboard.settings.captureEnabled')} onChange={(value) => patch({ captureEnabled: value })} />
          </label>
          <label className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.captureImages')}</span>
              <span className={HINT}>{t('clipboard.settings.captureImagesHint')}</span>
            </span>
            <Check checked={draft.captureImages} label={t('clipboard.settings.captureImages')} onChange={(value) => patch({ captureImages: value })} />
          </label>
          <div className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.retention')}</span>
              <span className={HINT}>{t('clipboard.settings.retentionHint')}</span>
            </span>
            <Select
              value={String(draft.retentionDays)}
              onValueChange={(value) => patch({ retentionDays: Number(value) })}
            >
              <SelectTrigger
                aria-label={t('clipboard.settings.retention')}
                className={`${INPUT} h-7 w-auto shrink-0 border-0`}
                data-testid="clipboard-settings-retention"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_OPTIONS.map((option) => (
                  <SelectItem key={option.days} value={String(option.days)}>{t(option.key)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.maxEntries')}</span>
              <span className={HINT}>{t('clipboard.settings.maxEntriesHint')}</span>
            </span>
            <input
              type="number"
              min={1}
              value={draft.maxEntries}
              onChange={(event) => patch({ maxEntries: Math.max(1, Number(event.target.value) || 1) })}
              aria-label={t('clipboard.settings.maxEntries')}
              className={`${INPUT} w-24 shrink-0`}
              data-testid="clipboard-settings-max-entries"
            />
          </div>
          <label className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.hideSensitive')}</span>
              <span className={HINT}>{t('clipboard.settings.hideSensitiveHint')}</span>
            </span>
            <Check checked={draft.hideSensitive} label={t('clipboard.settings.hideSensitive')} onChange={(value) => patch({ hideSensitive: value })} />
          </label>
          <label className={ROW}>
            <span className="min-w-0">
              <span className="block text-body">{t('clipboard.settings.hotkey')}</span>
              <span className={HINT}>{t('clipboard.settings.hotkeyHint')}</span>
            </span>
            <Check checked={draft.globalShortcutEnabled} label={t('clipboard.settings.hotkey')} onChange={(value) => patch({ globalShortcutEnabled: value })} />
          </label>
          <div className={ROW}>
            <span className="text-body text-text-muted">{t('clipboard.settings.hotkey')}</span>
            <input
              type="text"
              value={draft.globalShortcut}
              onChange={(event) => patch({ globalShortcut: event.target.value })}
              aria-label={t('clipboard.settings.hotkey')}
              spellCheck={false}
              className={`${INPUT} w-56 shrink-0 font-mono`}
              data-testid="clipboard-settings-hotkey"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={saving}
            data-testid="clipboard-settings-save"
            onClick={() => { onSave(draft); onOpenChange(false) }}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}