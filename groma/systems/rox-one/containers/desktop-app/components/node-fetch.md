---
type: C4 Component
title: Node fetch
status: stable
groma:
  id: node-fetch
  parent: desktop-app
  code:
    - scanner: javascript
      file: apps/electron/src/main/shims/node-fetch.cjs
    - scanner: javascript
      file: apps/electron/src/main/shims/node-sqlite.cjs
    - scanner: javascript
      file: apps/electron/src/main/shims/abort-controller.cjs
  technology: esbuild alias
description: Replaces the bundled HTTP client with native fetch for the Telegram bot runtime.
---
