---
type: C4 Component
title: Eslint config
status: stable
groma:
  id: webui-eslint-config
  parent: web-ui
  code:
    - scanner: javascript
      file: apps/webui/eslint.config.mjs
    - scanner: typescript
      file: apps/webui/vite.config.ts
description: ESLint configuration for the web UI app.
---
