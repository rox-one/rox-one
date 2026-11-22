---
type: C4 Component
title: Gigaam adapter
status: stable
groma:
  id: gigaam-adapter
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/voice/local/gigaam-adapter.ts
      symbol: GigaamE2eRnntAdapter
    - scanner: typescript
      file: packages/shared/src/voice/local/adapter.ts
    - scanner: typescript
      file: packages/shared/src/voice/local/whisper-adapter.ts
      symbol: WhisperLargeV3TurboAdapter
    - scanner: typescript
      file: packages/shared/src/voice/local/nemotron-adapter.ts
description: Adapts the Russian GigaAM e2e_rnnt local ASR model, currently returning fixture transcripts until weights install.
---
