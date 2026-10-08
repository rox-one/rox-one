import { enUS } from "date-fns/locale/en-US";
import { DATE_LOCALES } from "./date-locales";
import type { LanguageCode } from "./locale-meta";

/** Get the date-fns Locale matching the current i18n language code. */
export function getDateLocale(lang: string): import("date-fns").Locale {
  return DATE_LOCALES[lang as LanguageCode] ?? enUS;
}
