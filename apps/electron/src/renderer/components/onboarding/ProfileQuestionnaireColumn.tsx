/**
 * ProfileQuestionnaireColumn
 *
 * The left column of the two-column onboarding questionnaire. Standalone: the
 * wizard step mounts it and owns the surrounding layout, persistence and the
 * Continue button (gate on `isProfileQuestionnaireComplete`).
 *
 * The «А предложи сам?» button fills the preferences text through the
 * `onSuggest` prop the step wires up. A suggestion only lands when the field
 * was not edited while the request was in flight.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Sparkles } from 'lucide-react'
import { LANGUAGES } from '@rox/shared/i18n/languages'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  PROFILE_LANGUAGE_AUTO,
  getCityOptions,
  getTimeZoneOptions,
  isProfileLanguage,
  type ProfileQuestionnaire,
} from './profile-questionnaire-model'

/**
 * Iridescent sweep built only from existing semantic colour tokens
 * (`--accent`, `--info`, `--success`) and the shared `shimmer` keyframes —
 * no new colours are introduced.
 */
const SUGGEST_GRADIENT = [
  'linear-gradient(100deg,',
  'color-mix(in oklab, var(--accent) 34%, transparent) 0%,',
  'color-mix(in oklab, var(--info) 30%, transparent) 30%,',
  'color-mix(in oklab, var(--success) 30%, transparent) 60%,',
  'color-mix(in oklab, var(--accent) 34%, transparent) 100%)',
].join(' ')

interface SelectOption {
  value: string
  label: string
}

function ProfileSelect({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = React.useId()
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export interface ProfileQuestionnaireColumnProps {
  value: ProfileQuestionnaire
  onChange: (next: ProfileQuestionnaire) => void
  /** Returns the suggested preferences text; wired by the wizard step. */
  onSuggest: () => Promise<string>
  disabled?: boolean
  className?: string
}

export function ProfileQuestionnaireColumn({
  value,
  onChange,
  onSuggest,
  disabled,
  className,
}: ProfileQuestionnaireColumnProps) {
  const { t } = useTranslation()
  const fullNameId = React.useId()
  const birthDateId = React.useId()
  const preferencesId = React.useId()
  const [suggesting, setSuggesting] = React.useState(false)
  const [suggestError, setSuggestError] = React.useState<string | null>(null)

  // Latest value for async work (the suggestion may resolve after re-renders).
  const valueRef = React.useRef(value)
  valueRef.current = value

  // Guards against writing a late suggestion into an unmounted column.
  const mountedRef = React.useRef(true)
  React.useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  const update = React.useCallback(
    (patch: Partial<ProfileQuestionnaire>) => {
      onChange({ ...valueRef.current, ...patch })
    },
    [onChange],
  )

  const languageOptions = React.useMemo<SelectOption[]>(
    () => [
      { value: PROFILE_LANGUAGE_AUTO, label: t('onboarding.profile.languageAuto') },
      ...Object.entries(LANGUAGES).map(([code, config]) => ({
        value: code,
        label: config.nativeName,
      })),
    ],
    [t],
  )

  const cityOptions = React.useMemo(
    () => getCityOptions(value.city).map((city) => ({ value: city, label: city })),
    [value.city],
  )

  const timeZoneOptions = React.useMemo(
    () => getTimeZoneOptions(value.timeZone).map((zone) => ({ value: zone, label: zone })),
    [value.timeZone],
  )

  const todayIso = React.useMemo(() => new Date().toISOString().slice(0, 10), [])

  const handleSuggest = React.useCallback(async () => {
    if (suggesting) return
    const startPreferences = valueRef.current.preferences
    setSuggestError(null)
    setSuggesting(true)
    try {
      const suggestion = await onSuggest()
      const current = valueRef.current
      // Fill only when still mounted and the user has not edited the field
      // while we were generating.
      if (mountedRef.current && startPreferences === current.preferences) {
        onChange({ ...current, preferences: suggestion })
      }
    } catch (error) {
      setSuggestError(
        error instanceof Error && error.message
          ? error.message
          : t('onboarding.profile.suggestError'),
      )
    } finally {
      setSuggesting(false)
    }
  }, [onChange, onSuggest, suggesting, t])

  return (
    <div
      data-testid="profile-questionnaire-column"
      className={cn('flex flex-col gap-5', className)}
    >
      <div className="space-y-2">
        <Label htmlFor={fullNameId}>{t('onboarding.profile.fullName')}</Label>
        <Input
          id={fullNameId}
          value={value.fullName ?? ''}
          onChange={(event) => update({ fullName: event.target.value })}
          placeholder={t('onboarding.profile.fullNamePlaceholder')}
          disabled={disabled}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={birthDateId}>{t('onboarding.profile.birthDate')}</Label>
        <Input
          id={birthDateId}
          type="date"
          value={value.birthDate ?? ''}
          max={todayIso}
          onChange={(event) => update({ birthDate: event.target.value })}
          disabled={disabled}
          className="w-full"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ProfileSelect
          label={t('onboarding.profile.uiLanguage')}
          value={value.uiLanguage}
          options={languageOptions}
          onChange={(next) => {
            if (isProfileLanguage(next)) update({ uiLanguage: next })
          }}
          disabled={disabled}
        />
        <ProfileSelect
          label={t('onboarding.profile.chatLanguage')}
          value={value.chatLanguage}
          options={languageOptions}
          onChange={(next) => {
            if (isProfileLanguage(next)) update({ chatLanguage: next })
          }}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ProfileSelect
          label={t('onboarding.profile.city')}
          value={value.city ?? ''}
          options={cityOptions}
          onChange={(city) => update({ city })}
          disabled={disabled}
        />
        <ProfileSelect
          label={t('onboarding.profile.timeZone')}
          value={value.timeZone}
          options={timeZoneOptions}
          onChange={(timeZone) => update({ timeZone })}
          disabled={disabled}
        />
      </div>

      <div data-testid="profile-preferences" className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={preferencesId}>{t('onboarding.profile.preferences')}</Label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('onboarding.profile.preferencesHint')}
          </p>
          <Textarea
            id={preferencesId}
            value={value.preferences}
            onChange={(event) => update({ preferences: event.target.value })}
            placeholder={t('onboarding.profile.preferencesPlaceholder')}
            rows={6}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handleSuggest()
            }}
            disabled={disabled || suggesting}
            aria-busy={suggesting}
            data-testid="profile-suggest-button"
            className={cn(
              'relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-4 py-1.5 text-xs font-medium text-foreground',
              'border-accent/30 bg-background/60 transition-colors duration-[var(--motion-fast)]',
              'hover:border-accent/50 focus-visible:outline-none focus-visible:ring-[length:var(--ring-width)] focus-visible:ring-focus/55',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-80 [animation:shimmer_3.5s_ease-in-out_infinite] [background-size:220%_100%] motion-reduce:[animation:none]"
              style={{ backgroundImage: SUGGEST_GRADIENT }}
            />
            <span className="relative inline-flex items-center gap-1.5">
              {suggesting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3.5" aria-hidden="true" />
              )}
              {suggesting
                ? t('onboarding.profile.suggesting')
                : t('onboarding.profile.suggest')}
            </span>
          </button>

          {suggestError ? (
            <p role="alert" className="text-xs text-destructive">
              {suggestError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}