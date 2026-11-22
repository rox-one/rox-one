---
type: C4 Component
title: Register
status: stable
groma:
  id: keeper-register
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/keeper/register.ts
      symbol: registerKeeperGuiHandlers
  technology: Electron safeStorage
description: Wires ROX Keeper vault RPC handlers to the config directory and OS key custody.
---
