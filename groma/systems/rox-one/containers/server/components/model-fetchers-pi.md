---
type: C4 Component
title: Pi
status: stable
groma:
  id: model-fetchers-pi
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/pi.ts
      symbol: PiModelFetcher
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/bedrock-vertex.ts
      symbol: BedrockVertexModelFetcher
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/index.ts
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/anthropic.ts
      symbol: AnthropicModelFetcher
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/registry.ts
      symbol: MODEL_FETCHERS
    - scanner: typescript
      file: packages/server-core/src/model-fetchers/runtime.ts
description: Discovers available models by delegating to backend drivers for a connection.
---
