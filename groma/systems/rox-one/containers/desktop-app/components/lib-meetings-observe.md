---
type: C4 Component
title: Observe
status: stable
groma:
  id: lib-meetings-observe
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/observe.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/auto-extraction.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/calendar-autostart.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/meeting-task-bridge.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/transcript-notes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/lib/meetings/recorder.ts
description: Maps transcript provenance to observation chips and rolling summary blocks for the meetings UI.
---
