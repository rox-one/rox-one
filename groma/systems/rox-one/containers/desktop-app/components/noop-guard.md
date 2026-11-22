---
type: C4 Component
title: Noop guard
status: stable
groma:
  id: noop-guard
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/lib/dev/noop-guard.ts
description: Dev-only guard that outlines and warns about clicked controls with no interaction handler.
---
