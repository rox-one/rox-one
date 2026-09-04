/**
 * Canonical locale registry — single source of truth for all supported locales.
 *
 * To add a new locale:
 * 1. Create the locale JSON file in ./locales/
 * 2. Import the messages and date-fns locale below
 * 3. Add one entry to LOCALE_REGISTRY
 *
 * Everything else (SUPPORTED_LANGUAGE_CODES, LANGUAGES, i18n resources,
 * date locale lookup) is derived automatically. No other file needs to change.
 */

import type { Locale } from "date-fns";

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

// ─── date-fns locales ────────────────────────────────────────────────────────
import { ar as arDateLocale } from "date-fns/locale/ar";
import { de as deDateLocale } from "date-fns/locale/de";
import { enUS } from "date-fns/locale/en-US";
import { es as esDateLocale } from "date-fns/locale/es";
import { fr as frDateLocale } from "date-fns/locale/fr";
import { hu as huDateLocale } from "date-fns/locale/hu";
import { ja as jaDateLocale } from "date-fns/locale/ja";
import { ko as koDateLocale } from "date-fns/locale/ko";
import { pl as plDateLocale } from "date-fns/locale/pl";
import { ru as ruDateLocale } from "date-fns/locale/ru";
import { zhCN } from "date-fns/locale/zh-CN";
import { zhTW } from "date-fns/locale/zh-TW";

// ─── Registry ────────────────────────────────────────────────────────────────

interface LocaleEntry {
  nativeName: string;
  messages: Record<string, string>;
  dateLocale: Locale;
}

export const LOCALE_REGISTRY = {
  en: { nativeName: "English", messages: enMessages, dateLocale: enUS },
  ru: { nativeName: "Русский", messages: ruMessages, dateLocale: ruDateLocale },
  es: { nativeName: "Español", messages: esMessages, dateLocale: esDateLocale },
  "zh-Hans": {
    nativeName: "简体中文",
    messages: zhHansMessages,
    dateLocale: zhCN,
  },
  "zh-Hant": {
    nativeName: "繁體中文",
    messages: zhHantMessages,
    dateLocale: zhTW,
  },
  ja: { nativeName: "日本語", messages: jaMessages, dateLocale: jaDateLocale },
  de: {
    nativeName: "Deutsch",
    messages: deMessages,
    dateLocale: deDateLocale,
  },
  hu: { nativeName: "Magyar", messages: huMessages, dateLocale: huDateLocale },
  pl: { nativeName: "Polski", messages: plMessages, dateLocale: plDateLocale },
  fr: { nativeName: "Français", messages: frMessages, dateLocale: frDateLocale },
  ko: { nativeName: "한국어", messages: koMessages, dateLocale: koDateLocale },
  ar: { nativeName: "العربية", messages: arMessages, dateLocale: arDateLocale },
} satisfies Record<string, LocaleEntry>;

export type LanguageCode = keyof typeof LOCALE_REGISTRY;
