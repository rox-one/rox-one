---
type: C4 Component
title: Register helper
status: stable
groma:
  id: register-helper
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/calendar/register-helper.ts
    - scanner: typescript
      file: apps/electron/src/main/calendar/google-oauth.ts
  technology: EventKit
description: Resolves and registers the macOS calendar helper binary for the Apple Calendar adapter.
---
