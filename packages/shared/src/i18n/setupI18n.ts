import i18n, { type i18n as I18nInstance, type InitOptions } from "i18next";
import { LOCALE_REGISTRY } from "./registry";
import {
  DEFAULT_LANGUAGE_CODE,
  SUPPORTED_LANGUAGE_CODES,
} from "./languages";

// Build i18next resources from the locale registry. Computed inside
// setupI18n() so importing this module has no top-level work.
const buildResources = () => Object.fromEntries(
  Object.entries(LOCALE_REGISTRY).map(([code, entry]) => [
    code,
    { translation: entry.messages },
  ]),
);

// Safe as a boolean guard because init is synchronous (initImmediate: false).
// If async init is ever needed, replace with a promise-based singleton.
let initialized = false;

/**
 * Initialize i18next with every bundled translation, synchronously.
 *
 * Used by the main process and tests. Renderer entries should use
 * `setupRendererI18n()` from `@rox/shared/i18n/lazy`, which keeps the other
 * eleven locales out of the startup bundle.
 * Call once at app startup. Pass `plugins` to add framework integrations
 * (e.g. initReactI18next for React apps, LanguageDetector for browser apps).
 */
export function setupI18n(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: any[] = [],
): I18nInstance {
  if (initialized) return i18n;

  let instance = i18n;
  for (const plugin of plugins) {
    instance = instance.use(plugin);
  }

  instance.init({
    resources: buildResources(),
    // Russian is the default UI language; English remains the key-missing
    // fallback after it.
    fallbackLng: [DEFAULT_LANGUAGE_CODE, "en"],
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    initImmediate: false, // synchronous init — resources are bundled inline
    detection: {
      // Explicit user choice (localStorage) wins; otherwise the default
      // language is Russian — the OS locale (navigator) must not override it.
      order: ["localStorage"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  } as InitOptions);

  initialized = true;
  return i18n;
}

export { i18n };
