---
type: C4 Component
title: Install rox defaults
status: stable
groma:
  id: install-rox-defaults
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/rox-defaults/install-rox-defaults.ts
      symbol: installRoxDefaults
description: Seeds the embedded shared ROX API key into the environment when none is provided.
---
