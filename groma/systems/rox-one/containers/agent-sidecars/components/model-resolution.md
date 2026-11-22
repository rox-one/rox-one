---
type: C4 Component
title: Model resolution
status: stable
groma:
  id: model-resolution
  parent: agent-sidecars
  code:
    - scanner: typescript
      file: packages/pi-agent-server/src/model-resolution.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/pick-mini-model.ts
      symbol: pickProviderAppropriateMiniModel
    - scanner: typescript
      file: packages/pi-agent-server/src/kimi-coding-models.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/index.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/session-settings.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/custom-endpoint-models.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/ephemeral-query-lifecycle.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/adapt-credential.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/craft-bash-tool.ts
      symbol: createCraftBashToolDefinition
    - scanner: typescript
      file: packages/pi-agent-server/src/system-prompt-override.ts
      symbol: applySystemPromptOverride
    - scanner: typescript
      file: packages/pi-agent-server/src/stdin-close-policy.ts
      symbol: shouldShutdownOnStdinClose
    - scanner: typescript
      file: packages/pi-agent-server/src/craft-metadata-schema.ts
description: Resolves Pi SDK models with provider precedence and custom-endpoint fallbacks.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/pi-agent-server/src/index.ts](../../../../../../packages/pi-agent-server/src/index.ts) | [llm-providers](../../../../../externals/llm-providers.md) | Calls models | HTTPS |
