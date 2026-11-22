---
type: C4 Component
title: No hardcoded path separator
status: stable
groma:
  id: no-hardcoded-path-separator
  parent: desktop-app
  code:
    - scanner: javascript
      file: apps/electron/eslint-rules/no-hardcoded-path-separator.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-nonstandard-shadows.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-direct-file-open.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-direct-navigation-state.cjs
      symbol: getAncestors
    - scanner: javascript
      file: apps/electron/eslint-rules/no-backdrop-on-overlay.cjs
      symbol: fullName
    - scanner: javascript
      file: apps/electron/eslint-rules/no-arbitrary-text-size.cjs
      symbol: suggestion
    - scanner: javascript
      file: apps/electron/eslint-rules/no-arbitrary-radius.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-raw-error-render.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-inline-source-auth-check.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-localstorage.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-direct-platform-check.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-foreground-opacity.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/prefer-primitives.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/no-raw-color.cjs
      symbol: staticString
    - scanner: javascript
      file: apps/electron/eslint-rules/no-hardcoded-z-index.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/ui-tokens.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/icon-size-tokens.cjs
description: ESLint rule rejecting hardcoded path separators in path comparisons to keep Windows compatibility.
---
