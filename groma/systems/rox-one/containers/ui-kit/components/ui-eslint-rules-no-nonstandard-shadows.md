---
type: C4 Component
title: No nonstandard shadows
status: stable
groma:
  id: ui-eslint-rules-no-nonstandard-shadows
  parent: ui-kit
  code:
    - scanner: javascript
      file: packages/ui/eslint-rules/no-nonstandard-shadows.cjs
    - scanner: javascript
      file: packages/ui/eslint-rules/no-floating-z-tokens-in-island.cjs
    - scanner: javascript
      file: packages/ui/eslint-rules/no-hardcoded-z-index.cjs
  technology: ESLint
description: ESLint rule restricting shadow utilities and inline box-shadow usage.
---
