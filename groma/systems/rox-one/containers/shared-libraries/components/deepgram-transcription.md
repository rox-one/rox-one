---
type: C4 Component
title: Deepgram transcription
status: stable
groma:
  id: deepgram-transcription
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/adapters/deepgram-transcription.ts
    - scanner: typescript
      file: packages/shared/src/voice/adapters/audio-result.ts
    - scanner: typescript
      file: packages/shared/src/voice/adapters/edge-tts.ts
    - scanner: typescript
      file: packages/shared/src/voice/adapters/rox-transcription.ts
  technology: Deepgram
description: Normalizes Deepgram transcription responses into validated timed transcript segments and words.
---
