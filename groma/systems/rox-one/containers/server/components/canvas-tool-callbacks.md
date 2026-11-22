---
type: C4 Component
title: Tool callbacks
status: stable
groma:
  id: canvas-tool-callbacks
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/canvas/tool-callbacks.ts
    - scanner: typescript
      file: packages/server-core/src/canvas/links-ensure-host.ts
    - scanner: typescript
      file: packages/server-core/src/canvas/store-host.ts
  technology: Yjs
description: Backs canvas entity-card creation and linking tools, writing links outside the Yjs document.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/canvas/tool-callbacks.ts](../../../../../../packages/server-core/src/canvas/tool-callbacks.ts) | [packages/server-core/src/sessions/SessionManager.ts](../../../../../../packages/server-core/src/sessions/SessionManager.ts) | Invokes supplied callbacks: canEditBoard, canViewEntity, createEntity, isCanvasEnabled, log | typescript |
