/**
 * ProfileQuestionnaire model — types, defaults, option lists, validation and
 * plain-JSON serialization for the left column of the two-column onboarding
 * questionnaire.
 *
 * Storage is owned by the parent (the wizard step) through the `value` /
 * `onChange` props; this module stays pure and React-free so the same helpers
 * power the Continue-button gate and the persisted preferences.
 */

import {
  isSupportedLanguageCode,
  type LanguageCode,
} from '@rox/shared/i18n/languages'

/** UI language / conversation language. `auto` follows the app locale. */
export type ProfileLanguage = 'auto' | LanguageCode

/** `auto` is always the first option in both language dropdowns. */
export const PROFILE_LANGUAGE_AUTO = 'auto' as const

/** Default languages (Russian) and location (Moscow, UTC+3). */
export const DEFAULT_PROFILE_LANGUAGE: ProfileLanguage = 'ru'
export const DEFAULT_PROFILE_CITY = 'Москва'
export const DEFAULT_PROFILE_TIME_ZONE = 'Europe/Moscow'

export interface ProfileQuestionnaire {
  fullName?: string
  /** ISO `yyyy-mm-dd`, or empty when unset. */
  birthDate?: string
  uiLanguage: ProfileLanguage
  chatLanguage: ProfileLanguage
  city?: string
  /** IANA time zone id. */
  timeZone: string
  preferences: string
}

/** JSON-safe shape handed to the parent for persistence. */
export interface ProfileQuestionnaireJson {
  fullName: string
  birthDate: string
  uiLanguage: ProfileLanguage
  chatLanguage: ProfileLanguage
  city: string
  timeZone: string
  preferences: string
}

/** Selectable cities for the questionnaire (a world map is future work). */
export const PROFILE_CITIES: readonly string[] = [
  'Москва',
  'Санкт-Петербург',
  'Новосибирск',
  'Екатеринбург',
  'Казань',
  'Нижний Новгород',
  'Челябинск',
  'Самара',
  'Омск',
  'Ростов-на-Дону',
  'Уфа',
  'Красноярск',
  'Воронеж',
  'Пермь',
  'Волгоград',
  'Краснодар',
  'Минск',
  'Алматы',
  'Тбилиси',
  'Ереван',
  'Бишкек',
  'Ташкент',
  'Стамбул',
  'Дубай',
  'Лондон',
  'Берлин',
  'Париж',
  'Нью-Йорк',
  'Токио',
  'Пекин',
]

/** Fallback set used when `Intl.supportedValuesOf('timeZone')` is unavailable. */
const FALLBACK_TIME_ZONES: readonly string[] = [
  'Europe/Moscow',
  'Europe/Kaliningrad',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/Minsk',
  'Asia/Almaty',
  'Asia/Tbilisi',
  'Asia/Yerevan',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
]

/** Cities to offer, keeping the currently selected custom city visible. */
export function getCityOptions(current?: string): string[] {
  const city = current?.trim()
  if (city && !PROFILE_CITIES.includes(city)) return [city, ...PROFILE_CITIES]
  return [...PROFILE_CITIES]
}

/** `Intl.supportedValuesOf` is missing from the lib types this project targets. */
type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

/** IANA zones to offer, keeping the selected zone visible and Moscow available. */
export function getTimeZoneOptions(current?: string): string[] {
  const intl = Intl as IntlWithSupportedValues
  const discovered =
    typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : []
  const zones = discovered.length > 0 ? [...discovered] : [...FALLBACK_TIME_ZONES]
  const selected = current?.trim()
  if (selected && !zones.includes(selected)) zones.unshift(selected)
  if (!zones.includes(DEFAULT_PROFILE_TIME_ZONE)) zones.unshift(DEFAULT_PROFILE_TIME_ZONE)
  return zones
}

export function isProfileLanguage(value: unknown): value is ProfileLanguage {
  return value === PROFILE_LANGUAGE_AUTO || isSupportedLanguageCode(value)
}

/**
 * Continue is enabled only once the required fields are filled: the name and
 * both language choices (city, birth date and preferences stay optional).
 */
export function isProfileQuestionnaireComplete(
  value: Pick<ProfileQuestionnaire, 'fullName' | 'uiLanguage' | 'chatLanguage'>,
): boolean {
  const fullName = value.fullName?.trim() ?? ''
  return (
    fullName.length > 0 &&
    isProfileLanguage(value.uiLanguage) &&
    isProfileLanguage(value.chatLanguage)
  )
}

export function createDefaultProfileQuestionnaire(): ProfileQuestionnaire {
  return {
    fullName: '',
    birthDate: '',
    uiLanguage: DEFAULT_PROFILE_LANGUAGE,
    chatLanguage: DEFAULT_PROFILE_LANGUAGE,
    city: DEFAULT_PROFILE_CITY,
    timeZone: DEFAULT_PROFILE_TIME_ZONE,
    preferences: '',
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function normalizeBirthDate(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  return ISO_DATE.test(trimmed) ? trimmed : ''
}

/** Serialize to a JSON-safe object for the parent to persist. */
export function serializeProfileQuestionnaire(
  value: ProfileQuestionnaire,
): ProfileQuestionnaireJson {
  return {
    fullName: (value.fullName ?? '').trim(),
    birthDate: normalizeBirthDate(value.birthDate),
    uiLanguage: isProfileLanguage(value.uiLanguage) ? value.uiLanguage : DEFAULT_PROFILE_LANGUAGE,
    chatLanguage: isProfileLanguage(value.chatLanguage)
      ? value.chatLanguage
      : DEFAULT_PROFILE_LANGUAGE,
    city: (value.city ?? '').trim(),
    timeZone: value.timeZone?.trim() || DEFAULT_PROFILE_TIME_ZONE,
    preferences: value.preferences ?? '',
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Rehydrate a persisted JSON object, merging onto the defaults. */
export function parseProfileQuestionnaire(raw: unknown): ProfileQuestionnaire {
  const defaults = createDefaultProfileQuestionnaire()
  if (!isJsonObject(raw)) return defaults
  const record = raw
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value : fallback
  return {
    fullName: str(record.fullName, defaults.fullName ?? ''),
    birthDate: normalizeBirthDate(str(record.birthDate, '')),
    uiLanguage: isProfileLanguage(record.uiLanguage) ? record.uiLanguage : defaults.uiLanguage,
    chatLanguage: isProfileLanguage(record.chatLanguage)
      ? record.chatLanguage
      : defaults.chatLanguage,
    city: str(record.city, defaults.city ?? ''),
    timeZone: str(record.timeZone, defaults.timeZone),
    preferences: str(record.preferences, defaults.preferences),
  }
}