import i18n from "i18next";
import { DEFAULT_LANGUAGE_CODE } from "./languages";

/**
 * BCP-47 locale of the current app UI language, for `Intl.*` and
 * `toLocale*String()`. Dates and numbers must follow the language chosen in
 * Rox (default Russian), not the OS locale — passing `undefined` would pick
 * the system locale (e.g. en-US → "Mon", "Tuesday").
 */
export function getAppLocale(): string {
  return i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE_CODE;
}
