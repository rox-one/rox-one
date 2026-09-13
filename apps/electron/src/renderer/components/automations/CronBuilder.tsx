/**
 * CronBuilder
 *
 * Visual cron expression builder with three synchronized layers:
 * 1. Preset buttons — common schedules
 * 2. Visual fields — 5 interactive fields
 * 3. Raw expression — editable text input
 *
 * Plus human-readable summary and next-run preview.
 */

import * as React from 'react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { describeCron as describeCronExpression, computeNextRuns, type TranslateFn } from './utils'

const PRESETS = [
  { id: 'everyMinute', cron: '* * * * *' },
  { id: 'every15', cron: '*/15 * * * *' },
  { id: 'everyHour', cron: '0 * * * *' },
  { id: 'dailyMidnight', cron: '0 0 * * *' },
  { id: 'daily9am', cron: '0 9 * * *' },
  { id: 'weekdays9am', cron: '0 9 * * 1-5' },
  { id: 'monthly1st', cron: '0 0 1 * *' },
] as const

const PRESET_KEYS: Record<(typeof PRESETS)[number]['id'], string> = {
  everyMinute: 'automations.cronPresetEveryMinute',
  every15: 'automations.cronPresetEvery15',
  everyHour: 'automations.cronPresetEveryHour',
  dailyMidnight: 'automations.cronPresetDailyMidnight',
  daily9am: 'automations.cronPresetDaily9am',
  weekdays9am: 'automations.cronPresetWeekdays9am',
  monthly1st: 'automations.cronPresetMonthly1st',
}

const FIELD_KEYS = [
  'automations.cronFieldMinute',
  'automations.cronFieldHour',
  'automations.cronFieldDay',
  'automations.cronFieldMonth',
  'automations.cronFieldWeekday',
] as const

function validateCron(cron: string, t: TranslateFn): string | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return t('automations.cronInvalidParts')
  for (let i = 0; i < 5; i++) {
    const part = parts[i]
    if (part === '*') continue
    if (/^\*\/\d+$/.test(part)) continue
    if (/^[\d,\-\/]+$/.test(part)) continue
    return t('automations.cronInvalidField', {
      field: t(FIELD_KEYS[i] ?? 'automations.cronInvalid'),
      value: part,
    })
  }
  return null
}

interface CronFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
}

function CronField({ label, value, onChange }: CronFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full px-2 py-1.5 text-xs font-mono text-center rounded-md border border-border/50',
          'bg-background focus:outline-none focus:ring-1 focus:ring-accent/50',
        )}
        placeholder="*"
      />
    </div>
  )
}

export interface CronBuilderProps {
  value?: string
  onChange?: (cron: string) => void
  timezone?: string
  onTimezoneChange?: (tz: string) => void
  className?: string
}

export function CronBuilder({
  value = '0 9 * * 1-5',
  onChange,
  timezone,
  className,
}: CronBuilderProps) {
  const { t, i18n } = useTranslation()
  const [rawInput, setRawInput] = useState(value)
  const [fields, setFields] = useState<string[]>(value.split(/\s+/))

  useEffect(() => {
    setRawInput(value)
    setFields(value.split(/\s+/))
  }, [value])

  const handleRawChange = useCallback((raw: string) => {
    setRawInput(raw)
    const parts = raw.trim().split(/\s+/)
    if (parts.length === 5) {
      setFields(parts)
      onChange?.(raw.trim())
    }
  }, [onChange])

  const handleFieldChange = useCallback((index: number, val: string) => {
    const newFields = [...fields]
    newFields[index] = val || '*'
    setFields(newFields)
    const cron = newFields.join(' ')
    setRawInput(cron)
    onChange?.(cron)
  }, [fields, onChange])

  const handlePreset = useCallback((cron: string) => {
    setRawInput(cron)
    setFields(cron.split(/\s+/))
    onChange?.(cron)
  }, [onChange])

  const validationError = useMemo(() => validateCron(rawInput, t), [rawInput, t])
  const description = useMemo(() => describeCronExpression(rawInput, t), [rawInput, t])
  const nextRuns = useMemo(() => computeNextRuns(rawInput), [rawInput])

  return (
    <div className={cn('space-y-5', className)}>
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
          {t('automations.cronCommonSchedules')}
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.cron}
              onClick={() => handlePreset(preset.cron)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                rawInput === preset.cron
                  ? 'bg-foreground/10 text-foreground ring-1 ring-border/50'
                  : 'bg-foreground/[0.03] text-foreground/70 hover:bg-foreground/[0.06] shadow-minimal'
              )}
            >
              {t(PRESET_KEYS[preset.id])}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
          {t('automations.cronCustomSchedule')}
        </h4>
        <div className="grid grid-cols-5 gap-2">
          {FIELD_KEYS.map((key, i) => (
            <CronField
              key={key}
              label={t(key)}
              value={fields[i] || '*'}
              onChange={(val) => handleFieldChange(i, val)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
          {t('automations.cronAdvanced')}
        </h4>
        <input
          type="text"
          value={rawInput}
          onChange={(e) => handleRawChange(e.target.value)}
          className={cn(
            'w-full px-3 py-2 text-sm font-mono rounded-md border',
            'bg-background focus:outline-none focus:ring-1',
            validationError
              ? 'border-destructive/50 focus:ring-destructive/30'
              : 'border-border/50 focus:ring-accent/50'
          )}
          placeholder="* * * * *"
        />
        {validationError && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {validationError}
          </div>
        )}
      </div>

      <div className="bg-background shadow-minimal rounded-[8px] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{description}</span>
        </div>

        {nextRuns.length > 0 && !validationError && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('automations.labelNextRuns')}</span>
            <div className="flex flex-col gap-0.5">
              {(() => {
                const spansYears = nextRuns.length > 1 && nextRuns[0].getFullYear() !== nextRuns[nextRuns.length - 1].getFullYear()
                const locale = i18n.language || 'ru'
                return nextRuns.map((date, i) => (
                  <span key={i} className="text-xs text-foreground/70 tabular-nums">
                    {date.toLocaleDateString(locale, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      ...(spansYears && { year: 'numeric' }),
                    })} {date.toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </span>
                ))
              })()}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t('automations.labelTimezone')}:</span>
          <span className="font-medium text-foreground/70">{timezone || t('automations.systemDefault')}</span>
        </div>
      </div>
    </div>
  )
}
