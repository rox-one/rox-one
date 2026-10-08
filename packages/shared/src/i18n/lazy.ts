/**
 * Renderer i18n setup with on-demand locale bundles.
 *
 * `setupI18n()` statically imports all twelve locales (~7 MB of JSON), which
 * made every renderer window parse them before first paint. This module keeps
 * the same i18next configuration but holds only the active language and its
 * fallback chain (Russian, then English) in memory:
 *
 *   1. `preloadRendererLocales()` — call and await before the first render
 *      (bootstrap.ts does this before importing main.tsx). It fetches the
 *      persisted language plus the fallback chain in parallel.
 *   2. `setupRendererI18n(plugins)` — synchronous init with the preloaded
 *      bundles, exactly like `setupI18n()`, so `t()` is ready immediately.
 *   3. Any other language is fetched by a tiny i18next backend when
 *      `i18n.changeLanguage()` is called; i18next waits for the bundle before
 *      switching, so the UI never shows raw keys during a switch.
 *
 * `initRendererI18n(plugins)` combines 1 and 2 for standalone entries.
 */
import i18n, {
  type BackendModule,
  type i18n as I18nInstance,
  type InitOptions,
  type ReadCallback,
} from "i18next";
import {
  DEFAULT_LANGUAGE_CODE,
  SUPPORTED_LANGUAGE_CODES,
  isSupportedLanguageCode,
  type LanguageCode,
} from "./languages";
import { LOCALE_MESSAGE_LOADERS, type LocaleMessages } from "./locale-loaders";

/** localStorage key written by i18next-browser-languagedetector. */
export const I18N_STORAGE_KEY = "i18nextLng";

/** Same chain as setupI18n(): Russian default, English for missing keys. */
export const FALLBACK_LANGUAGE_CHAIN: readonly LanguageCode[] = [DEFAULT_LANGUAGE_CODE, "en"];

const loaded = new Map<LanguageCode, LocaleMessages>();
const inflight = new Map<LanguageCode, Promise<LocaleMessages>>();

/** Fetch (once) and cache one locale's messages. */
export function loadLocaleMessages(code: LanguageCode): Promise<LocaleMessages> {
  const cached = loaded.get(code);
  if (cached) return Promise.resolve(cached);
  let pending = inflight.get(code);
  if (!pending) {
    pending = LOCALE_MESSAGE_LOADERS[code]().then(
      (messages) => {
        loaded.set(code, messages);
        inflight.delete(code);
        return messages;
      },
      (error: unknown) => {
        inflight.delete(code);
        throw error;
      },
    );
    inflight.set(code, pending);
  }
  return pending;
}

/** Codes whose messages are already in memory (for tests/diagnostics). */
export function getLoadedLocaleCodes(): LanguageCode[] {
  return [...loaded.keys()];
}

/**
 * The language i18next will pick on startup: the persisted detector choice
 * when it maps to a supported code (exact, then language-only, then the first
 * supported regional variant), otherwise the Russian default. Mirrors the
 * `order: ['localStorage']` detection + i18next best-match used by setupI18n.
 * A mismatch is harmless: the backend loads whatever i18next actually picks.
 */
export function resolveInitialLanguage(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): LanguageCode {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(I18N_STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (!stored) return DEFAULT_LANGUAGE_CODE;
  if (isSupportedLanguageCode(stored)) return stored;
  const base = stored.split(/[-_]/)[0]?.toLowerCase();
  if (base) {
    if (isSupportedLanguageCode(base)) return base;
    const regional = SUPPORTED_LANGUAGE_CODES.find((code) => code.toLowerCase().startsWith(`${base}-`));
    if (regional) return regional;
  }
  return DEFAULT_LANGUAGE_CODE;
}

/** Languages to have in memory before the first render. */
export function startupLanguages(initial: LanguageCode = resolveInitialLanguage()): LanguageCode[] {
  return [...new Set<LanguageCode>([initial, ...FALLBACK_LANGUAGE_CHAIN])];
}

/**
 * Load the startup languages. Never rejects: a failed chunk falls back to the
 * backend, which retries when i18next asks for it.
 */
export async function preloadRendererLocales(
  languages: readonly LanguageCode[] = startupLanguages(),
): Promise<void> {
  await Promise.all(languages.map((code) => loadLocaleMessages(code).catch(() => undefined)));
}

/** i18next backend that resolves bundles through the lazy loaders. */
export const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language: string, namespace: string, callback: ReadCallback) {
    if (namespace !== "translation" || !isSupportedLanguageCode(language)) {
      callback(null, {});
      return;
    }
    loadLocaleMessages(language).then(
      (messages) => callback(null, messages),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false),
    );
  },
};

let initialized = false;

/**
 * Initialize i18next for a renderer window. Synchronous: resources already in
 * memory (see preloadRendererLocales) are available to `t()` immediately.
 */
export function setupRendererI18n(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: any[] = [],
): I18nInstance {
  if (initialized) return i18n;

  let instance = i18n.use(lazyLocaleBackend);
  for (const plugin of plugins) {
    instance = instance.use(plugin);
  }

  const resources = Object.fromEntries(
    [...loaded].map(([code, messages]) => [code, { translation: messages }]),
  );

  instance.init({
    resources,
    // Keep bundles that are not in `resources` loadable through the backend.
    partialBundledLanguages: true,
    // Russian is the default UI language; English remains the key-missing
    // fallback after it. (Identical to setupI18n.)
    fallbackLng: [...FALLBACK_LANGUAGE_CHAIN],
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    initAsync: false,
    detection: {
      // Explicit user choice (localStorage) wins; otherwise the default
      // language is Russian — the OS locale (navigator) must not override it.
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: I18N_STORAGE_KEY,
    },
  } as InitOptions);

  initialized = true;
  return i18n;
}

/** Preload the startup languages, then initialize. For standalone entries. */
export async function initRendererI18n(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: any[] = [],
): Promise<I18nInstance> {
  await preloadRendererLocales();
  return setupRendererI18n(plugins);
}

export { i18n };
