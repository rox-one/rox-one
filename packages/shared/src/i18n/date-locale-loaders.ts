/**
 * On-demand loaders for date-fns locales.
 *
 * Message JSON is already lazy (`locale-loaders.ts`). The old static
 * `DATE_LOCALES` map pulled every language's formatDistance / localize / match
 * modules into the renderer boot closure (~76 modules) through `getDateLocale`.
 * Each `import()` here is its own chunk; only English (the sync fallback) stays
 * static in `date-locale.ts`. Main/tests keep the eager map in `date-locales.ts`.
 */
import type { Locale } from "date-fns";
import type { LanguageCode } from "./locale-meta";

export const DATE_LOCALE_LOADERS: Record<LanguageCode, () => Promise<Locale>> = {
  en: () => import("date-fns/locale/en-US").then((m) => m.enUS),
  ru: () => import("date-fns/locale/ru").then((m) => m.ru),
  es: () => import("date-fns/locale/es").then((m) => m.es),
  "zh-Hans": () => import("date-fns/locale/zh-CN").then((m) => m.zhCN),
  "zh-Hant": () => import("date-fns/locale/zh-TW").then((m) => m.zhTW),
  ja: () => import("date-fns/locale/ja").then((m) => m.ja),
  de: () => import("date-fns/locale/de").then((m) => m.de),
  hu: () => import("date-fns/locale/hu").then((m) => m.hu),
  pl: () => import("date-fns/locale/pl").then((m) => m.pl),
  fr: () => import("date-fns/locale/fr").then((m) => m.fr),
  ko: () => import("date-fns/locale/ko").then((m) => m.ko),
  ar: () => import("date-fns/locale/ar").then((m) => m.ar),
};
