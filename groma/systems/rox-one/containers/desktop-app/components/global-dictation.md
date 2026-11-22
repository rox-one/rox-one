---
type: C4 Component
title: Global dictation
status: stable
groma:
  id: global-dictation
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/voice/global-dictation.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/voice/global-dictation.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/voice/command-controller.ts
      symbol: VoiceCommandController
    - scanner: typescript
      file: apps/electron/src/renderer/voice/dictation-ownership.ts
    - scanner: typescript
      file: apps/electron/src/renderer/voice/composer-presence.ts
    - scanner: typescript
      file: apps/electron/src/renderer/voice/insert-target.ts
description: Runs global voice dictation, capturing microphone audio and inserting the transcript into the focused field.
---
