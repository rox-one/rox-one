---
type: C4 Component
title: Create search tool
status: stable
groma:
  id: create-search-tool
  parent: agent-sidecars
  code:
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/create-search-tool.ts
      symbol: createSearchTool
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/resolve-provider.ts
    - scanner: typescript
      file: packages/pi-agent-server/src/tools/search/types.ts
description: Builds the provider-agnostic web_search agent tool with optional research mode.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/pi-agent-server/src/tools/search/create-search-tool.ts](../../../../../../packages/pi-agent-server/src/tools/search/create-search-tool.ts) | [packages/pi-agent-server/src/index.ts](../../../../../../packages/pi-agent-server/src/index.ts) | Invokes supplied callback: search | typescript |
