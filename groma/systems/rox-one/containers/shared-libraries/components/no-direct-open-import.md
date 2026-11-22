---
type: C4 Component
title: No direct open import
status: stable
groma:
  id: no-direct-open-import
  parent: shared-libraries
  code:
    - scanner: javascript
      file: packages/shared/eslint-rules/no-direct-open-import.cjs
    - scanner: javascript
      file: packages/shared/eslint-rules/no-inline-source-auth-check.cjs
description: ESLint rule forbidding direct imports of the ESM-only open package in bundled Electron code.
---
