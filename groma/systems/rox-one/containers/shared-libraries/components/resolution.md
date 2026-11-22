---
type: C4 Component
title: Resolution
status: stable
groma:
  id: resolution
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/tts/resolution.ts
    - scanner: typescript
      file: packages/shared/src/voice/tts/streaming.ts
    - scanner: typescript
      file: packages/shared/src/voice/tts/synthesis.ts
description: Resolves which TTS provider to use from preference, persona, workspace config and voice model precedence.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/voice/tts/streaming.ts](../../../../../../packages/shared/src/voice/tts/streaming.ts) | [packages/server-core/src/handlers/rpc/voice-realtime.ts](../../../../../../packages/server-core/src/handlers/rpc/voice-realtime.ts) | Invokes supplied callback: synthesize | typescript |
