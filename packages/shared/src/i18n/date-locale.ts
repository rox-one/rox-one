import type { Locale } from "date-fns";
import { enUS } from "date-fns/locale/en-US";
import { DATE_LOCALE_LOADERS } from "./date-locale-loaders";
import { isSupportedLanguageCode } from "./languages";

const cache = new Map<string, Locale>([["en", enUS]]);
const inflight = new Map<string, Promise<Locale>>();

/** Get the cached date-fns Locale for an i18n language code. */
export function getDateLocale(lang: string): Locale {
  return cache.get(lang) ?? enUS;
}

/** Fetch (once) and cache one date-fns locale. Unknown codes resolve to en-US. */
export function loadDateLocale(lang: string): Promise<Locale> {
  const cached = cache.get(lang);
  if (cached) return Promise.resolve(cached);
  if (!isSupportedLanguageCode(lang)) return Promise.resolve(enUS);
  let pending = inflight.get(lang);
  if (!pending) {
    pending = DATE_LOCALE_LOADERS[lang]().then(
      (locale) => {
        cache.set(lang, locale);
        inflight.delete(lang);
        return locale;
      },
      (error: unknown) => {
        inflight.delete(lang);
        throw error;
      },
    );
    inflight.set(lang, pending);
  }
  return pending;
}

/** Load date-fns locales for the startup / fallback language chain. Never rejects. */
export async function preloadDateLocales(
  languages: readonly string[],
): Promise<void> {
  await Promise.all(
    languages.map((code) => loadDateLocale(code).catch(() => undefined)),
  );
}
