---
type: C4 Component
title: Use rox sources
status: stable
groma:
  id: use-rox-sources
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/lib/extra-screens/use-rox-sources.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/extra-screens/agent-run.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/extra-screens/storage.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/extra-screens/text-match.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/extra-screens/personal-task-bridge.ts
description: Provides read-only hooks for extra-screen sessions, personal tasks, meetings and messenger bindings.
---
