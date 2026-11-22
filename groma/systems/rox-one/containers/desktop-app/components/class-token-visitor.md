---
type: C4 Component
title: Class token visitor
status: stable
groma:
  id: class-token-visitor
  parent: desktop-app
  code:
    - scanner: javascript
      file: apps/electron/eslint-rules/lib/class-token-visitor.cjs
    - scanner: javascript
      file: apps/electron/eslint-rules/lib/ui-tokens.cjs
  technology: ESLint
description: AST visitor extracting static class strings for the rox UI token lint rules.
---
