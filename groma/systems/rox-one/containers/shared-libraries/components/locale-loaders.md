---
type: C4 Component
title: Locale loaders
status: stable
groma:
  id: locale-loaders
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/i18n/locale-loaders.ts
    - scanner: typescript
      file: packages/shared/src/i18n/lazy.ts
    - scanner: typescript
      file: packages/shared/src/i18n/index.ts
    - scanner: typescript
      file: packages/shared/src/i18n/languages.ts
    - scanner: typescript
      file: packages/shared/src/i18n/date-locale.ts
    - scanner: typescript
      file: packages/shared/src/i18n/date-locale-loaders.ts
      symbol: DATE_LOCALE_LOADERS
    - scanner: typescript
      file: packages/shared/src/i18n/date-locales.ts
      symbol: DATE_LOCALES
    - scanner: typescript
      file: packages/shared/src/i18n/registry.ts
      symbol: LOCALE_REGISTRY
    - scanner: typescript
      file: packages/shared/src/i18n/setupI18n.ts
      symbol: setupI18n
    - scanner: typescript
      file: packages/shared/src/i18n/app-locale.ts
      symbol: getAppLocale
    - scanner: typescript
      file: packages/shared/src/i18n/locale-meta.ts
description: Lazily imports per-language message bundles so only the active locale and fallback chain load at startup.
---
