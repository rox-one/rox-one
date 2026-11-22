---
type: C4 Component
title: Source gate
status: stable
groma:
  id: source-gate
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/pages/source-gate.ts
    - scanner: typescript
      file: packages/server-core/src/pages/tool-callbacks.ts
    - scanner: typescript
      file: packages/server-core/src/pages/script-executor-bridge.ts
    - scanner: typescript
      file: packages/server-core/src/pages/mcp-executor.ts
description: Rejects page actions when their granted source lost authentication, using a stable error prefix.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/pages/tool-callbacks.ts](../../../../../../packages/server-core/src/pages/tool-callbacks.ts) | [packages/server-core/src/sessions/SessionManager.ts](../../../../../../packages/server-core/src/sessions/SessionManager.ts) | Invokes supplied callbacks: log, onContentChanged, onPagesMutated | typescript |
