---
type: C4 Component
title: Install call defaults
status: stable
groma:
  id: install-call-defaults
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/team-calls/install-call-defaults.ts
      symbol: installCallDefaults
description: Installs build-time team-call credential defaults into the shared resolver.
---
