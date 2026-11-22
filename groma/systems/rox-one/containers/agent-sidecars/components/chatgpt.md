---
type: C4 Component
title: Chatgpt
status: stable
groma:
  id: chatgpt
  parent: agent-sidecars
  code:
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/chatgpt.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/responses-api-parser.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/openai.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/ddg.ts
      symbol: DDGSearchProvider
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/exa.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/providers/google.ts
      symbol: GoogleSearchProvider
description: Searches the web through the ChatGPT Codex backend using OAuth tokens.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/pi-agent-server/src/tools/search/providers/chatgpt.ts](../../../../../../packages/pi-agent-server/src/tools/search/providers/chatgpt.ts) | [packages/shared/src/config/llm-connections.ts](../../../../../../packages/shared/src/config/llm-connections.ts) | Reads LLM connections | TypeScript imports |
