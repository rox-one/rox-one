import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, type LanguageCode } from '@rox/shared/i18n/languages'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PROFILE_AUTO_LANGUAGE } from './profile-form'

/** Concrete language codes offered by the interface/communication dropdowns. */
export const PROFILE_LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[]

export interface LanguageSelectProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  className?: string
}

/**
 * Language dropdown. The FIRST option is «Авто» (the system locale / the
 * language of the question); the concrete codes follow, with Russian listed
 * first among them (the questionnaire default).
 */
export function LanguageSelect({ id, label, value, onChange, className }: LanguageSelectProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || PROFILE_AUTO_LANGUAGE} onValueChange={onChange}>
        <SelectTrigger id={id} data-testid={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PROFILE_AUTO_LANGUAGE}>{t('onboarding.profile.languageAuto')}</SelectItem>
          {PROFILE_LANGUAGE_CODES.map((code) => (
            <SelectItem key={code} value={code}>
              {LANGUAGES[code].nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * The supported time zones, from `Intl.supportedValuesOf('timeZone')`.
 * Falls back to the default zone when the runtime lacks the API.
 */
export function supportedTimeZones(): string[] {
  try {
    const intl: unknown = Intl
    if (intl && typeof intl === 'object' && 'supportedValuesOf' in intl && typeof intl.supportedValuesOf === 'function') {
      const supported: unknown = intl.supportedValuesOf('timeZone')
      if (Array.isArray(supported)) {
        const zones = supported.filter((zone): zone is string => typeof zone === 'string')
        if (zones.length > 0) return zones
      }
    }
  } catch {
    // Older runtimes: fall through to the default.
  }
  return ['Europe/Moscow']
}

/** Short "GMT+N" label for a zone, or '' when the runtime cannot format it. */
export function formatGmtOffset(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date())
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

export interface TimezoneFieldProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  className?: string
}

/** Searchable time-zone field: a text input backed by a native `<datalist>`. */
export function TimezoneField({ id, label, value, onChange, className }: TimezoneFieldProps) {
  const { t } = useTranslation()
  const zones = useMemo(supportedTimeZones, [])
  const offset = formatGmtOffset(value)
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        list={`${id}-options`}
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder="Europe/Moscow"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-options`}>
        {zones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground" data-testid={`${id}-offset`}>
        {offset ? `${value} (${offset})` : t('onboarding.profile.timezoneUnknown')}
      </p>
    </div>
  )
}

/** Local draft-friendly text field used for the left column's short inputs. */
export interface ProfileTextFieldProps {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  type?: string
  max?: string
  placeholder?: string
  required?: boolean
  className?: string
}

export function ProfileTextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  max,
  placeholder,
  required,
  className,
}: ProfileTextFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
      </Label>
      <Input
        id={id}
        type={type}
        max={max}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        aria-required={required || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}