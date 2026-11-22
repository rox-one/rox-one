---
type: C4 Component
title: Host
status: stable
groma:
  id: voice-host
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/host.ts
    - scanner: typescript
      file: packages/shared/src/voice/transcribe.ts
    - scanner: typescript
      file: packages/shared/src/voice/history-store.ts
    - scanner: typescript
      file: packages/shared/src/voice/wake-list.ts
    - scanner: typescript
      file: packages/shared/src/voice/capture-journal.ts
    - scanner: typescript
      file: packages/shared/src/voice/identity.ts
    - scanner: typescript
      file: packages/shared/src/voice/capabilities.ts
    - scanner: typescript
      file: packages/shared/src/voice/talk-events.ts
    - scanner: typescript
      file: packages/shared/src/voice/runtime.ts
    - scanner: typescript
      file: packages/shared/src/voice/transcript-reducer.ts
    - scanner: typescript
      file: packages/shared/src/voice/history.ts
    - scanner: typescript
      file: packages/shared/src/voice/realtime-transcription.ts
    - scanner: typescript
      file: packages/shared/src/voice/meeting-capture.ts
    - scanner: typescript
      file: packages/shared/src/voice/contracts.ts
    - scanner: typescript
      file: packages/shared/src/voice/policy.ts
    - scanner: typescript
      file: packages/shared/src/voice/meeting-stream.ts
    - scanner: typescript
      file: packages/shared/src/voice/realtime-bridge.ts
    - scanner: typescript
      file: packages/shared/src/voice/types.ts
    - scanner: typescript
      file: packages/shared/src/voice/flags.ts
    - scanner: typescript
      file: packages/shared/src/voice/job-machine.ts
    - scanner: typescript
      file: packages/shared/src/voice/provider-registry.ts
    - scanner: typescript
      file: packages/shared/src/voice/storage.ts
    - scanner: typescript
      file: packages/shared/src/voice/overlay-types.ts
    - scanner: typescript
      file: packages/shared/src/voice/index.ts
    - scanner: typescript
      file: packages/shared/src/voice/podcast-job.ts
    - scanner: typescript
      file: packages/shared/src/voice/hotkey-types.ts
    - scanner: typescript
      file: packages/shared/src/voice/realtime-bridge-types.ts
    - scanner: typescript
      file: packages/shared/src/voice/acceptance.ts
description: Coordinates voice capture jobs, journals, meeting recording and transcription adapters, emitting overlay and draft events.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/voice/realtime-transcription.ts](../../../../../../packages/shared/src/voice/realtime-transcription.ts) | [packages/shared/src/voice/realtime-providers/openai.ts](../../../../../../packages/shared/src/voice/realtime-providers/openai.ts) | Invokes supplied callbacks: decodeMessage, encodeAudio, handshake | typescript |
