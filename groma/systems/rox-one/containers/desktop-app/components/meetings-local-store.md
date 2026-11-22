---
type: C4 Component
title: Local store
status: stable
groma:
  id: meetings-local-store
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-store.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-extraction.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/capture.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/permissions.ts
      symbol: authorizeMainMeetingAction
    - scanner: typescript
      file: apps/electron/src/main/meetings/overlay.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/screen-context.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-observer.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-asr.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/cloud-asr.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-model.ts
    - scanner: typescript
      file: apps/electron/src/main/meetings/local-ipc.ts
description: Stores each local meeting as a folder with metadata, audio, transcript and attached documents.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/main/meetings/ipc.ts](../../../../../../apps/electron/src/main/meetings/ipc.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callbacks: getWorkspaceForWindow, getWorkspaceGenerationForWindow | typescript |
| [apps/electron/src/main/meetings/local-ipc.ts](../../../../../../apps/electron/src/main/meetings/local-ipc.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callbacks: getWorkspaceForWindow, getWorkspaceGenerationForWindow | typescript |
