---
type: C4 Component
title: Openai
status: stable
groma:
  id: realtime-providers-openai
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/realtime-providers/openai.ts
  technology: WebSocket
description: OpenAI Realtime WebSocket adapter for voice bridges, transcription and barge-in.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/voice/realtime-providers/openai.ts](../../../../../../packages/shared/src/voice/realtime-providers/openai.ts) | [packages/server-core/src/handlers/rpc/voice-realtime.ts](../../../../../../packages/server-core/src/handlers/rpc/voice-realtime.ts) | Invokes supplied callback: getApiKey | typescript |
