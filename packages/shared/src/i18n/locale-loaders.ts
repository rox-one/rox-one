/**
 * On-demand loaders for locale message bundles.
 *
 * Each `import()` becomes its own chunk in the renderer build, so only the
 * active language (plus the fallback chain) is fetched and parsed at startup.
 * Chunks ship inside the app, so switching language works offline.
 */
import type { LanguageCode } from "./locale-meta";

export type LocaleMessages = Record<string, string>;

const asMessages = (module: { default: unknown }): LocaleMessages =>
  module.default as LocaleMessages;

export const LOCALE_MESSAGE_LOADERS: Record<LanguageCode, () => Promise<LocaleMessages>> = {
  en: () => import("./locales/en.json").then(asMessages),
  ru: () => import("./locales/ru.json").then(asMessages),
  es: () => import("./locales/es.json").then(asMessages),
  "zh-Hans": () => import("./locales/zh-Hans.json").then(asMessages),
  "zh-Hant": () => import("./locales/zh-Hant.json").then(asMessages),
  ja: () => import("./locales/ja.json").then(asMessages),
  de: () => import("./locales/de.json").then(asMessages),
  hu: () => import("./locales/hu.json").then(asMessages),
  pl: () => import("./locales/pl.json").then(asMessages),
  fr: () => import("./locales/fr.json").then(asMessages),
  ko: () => import("./locales/ko.json").then(asMessages),
  ar: () => import("./locales/ar.json").then(asMessages),
};
