---
type: C4 Component
title: Chromium executable
status: stable
groma:
  id: chromium-executable
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/test-utils/chromium-executable.ts
      symbol: resolveChromiumExecutable
description: Resolves a usable Chromium executable for renderer browser test suites.
---
