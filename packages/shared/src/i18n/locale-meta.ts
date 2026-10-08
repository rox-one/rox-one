/**
 * Lightweight locale metadata — codes and native names only.
 *
 * Kept separate from `registry.ts` (which statically imports every locale's
 * messages, ~7 MB of JSON) so UI code that only needs the language list, the
 * language codes, or the date-fns locale does not pull every translation into
 * the renderer's startup bundle. Message bundles are loaded on demand through
 * `./locale-loaders` (renderer) or eagerly through `./registry` (main process,
 * tests).
 *
 * Key order is significant: it defines `SUPPORTED_LANGUAGE_CODES` and the
 * language picker order. Keep it identical to `LOCALE_REGISTRY`.
 */
export const LOCALE_META = {
  en: { nativeName: "English" },
  ru: { nativeName: "Русский" },
  es: { nativeName: "Español" },
  "zh-Hans": { nativeName: "简体中文" },
  "zh-Hant": { nativeName: "繁體中文" },
  ja: { nativeName: "日本語" },
  de: { nativeName: "Deutsch" },
  hu: { nativeName: "Magyar" },
  pl: { nativeName: "Polski" },
  fr: { nativeName: "Français" },
  ko: { nativeName: "한국어" },
  ar: { nativeName: "العربية" },
} as const satisfies Record<string, { nativeName: string }>;

export type LanguageCode = keyof typeof LOCALE_META;
