---
type: C4 Component
title: Command input
status: stable
groma:
  id: command-input
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/voice/command-input.ts
    - scanner: typescript
      file: apps/electron/src/main/voice/overlay-window.ts
      symbol: registerVoiceHotkeys
    - scanner: typescript
      file: apps/electron/src/main/voice/overlay-owner.ts
  technology: Electron before-input-event
description: Matches voice hotkey accelerators and key events for push-to-talk and cancel in the main process.
---
