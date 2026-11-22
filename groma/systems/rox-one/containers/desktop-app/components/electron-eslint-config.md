---
type: C4 Component
title: Eslint config
status: stable
groma:
  id: electron-eslint-config
  parent: desktop-app
  code:
    - scanner: javascript
      file: apps/electron/eslint.config.mjs
    - scanner: typescript
      file: apps/electron/vite.config.ts
description: ESLint flat configuration for the Electron app with custom navigation, storage and UI-token rules.
---
