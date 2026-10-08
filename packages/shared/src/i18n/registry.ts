/**
 * Canonical locale registry — every locale with its messages, eagerly loaded.
 *
 * To add a new locale:
 * 1. Create the locale JSON file in ./locales/
 * 2. Add its code + native name to LOCALE_META (./locale-meta.ts)
 * 3. Add its date-fns locale to DATE_LOCALES (./date-locales.ts)
 * 4. Import the messages below and add one entry to LOCALE_REGISTRY
 * 5. Add its loader to LOCALE_MESSAGE_LOADERS (./locale-loaders.ts)
 *
 * The type checks below fail if any of those maps is missing a code.
 *
 * Bundle note: this module statically imports all ~7 MB of locale JSON. The
 * main process and tests use it through `setupI18n()`. Renderer entries must
 * use `@rox/shared/i18n/lazy` instead, which loads only the active language
 * and its fallbacks.
 */

import type { Locale } from "date-fns";
import { DATE_LOCALES } from "./date-locales";
import { LOCALE_META, type LanguageCode } from "./locale-meta";

// ─── Translation resources ───────────────────────────────────────────────────
import arMessages from "./locales/ar.json";
import deMessages from "./locales/de.json";
import enMessages from "./locales/en.json";
import esMessages from "./locales/es.json";
import frMessages from "./locales/fr.json";
import huMessages from "./locales/hu.json";
import jaMessages from "./locales/ja.json";
import koMessages from "./locales/ko.json";
import plMessages from "./locales/pl.json";
import ruMessages from "./locales/ru.json";
import zhHansMessages from "./locales/zh-Hans.json";
import zhHantMessages from "./locales/zh-Hant.json";

// ─── Registry ────────────────────────────────────────────────────────────────

interface LocaleEntry {
  nativeName: string;
  messages: Record<string, string>;
  dateLocale: Locale;
}

const entry = <M extends Record<string, string>>(code: LanguageCode, messages: M) => ({
  nativeName: LOCALE_META[code].nativeName,
  messages,
  dateLocale: DATE_LOCALES[code],
});

export const LOCALE_REGISTRY = {
  en: entry("en", enMessages),
  ru: entry("ru", ruMessages),
  es: entry("es", esMessages),
  "zh-Hans": entry("zh-Hans", zhHansMessages),
  "zh-Hant": entry("zh-Hant", zhHantMessages),
  ja: entry("ja", jaMessages),
  de: entry("de", deMessages),
  hu: entry("hu", huMessages),
  pl: entry("pl", plMessages),
  fr: entry("fr", frMessages),
  ko: entry("ko", koMessages),
  ar: entry("ar", arMessages),
} satisfies Record<LanguageCode, LocaleEntry>;

export type { LanguageCode } from "./locale-meta";
