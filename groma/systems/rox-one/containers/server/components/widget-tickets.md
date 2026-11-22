---
type: C4 Component
title: Widget tickets
status: stable
groma:
  id: widget-tickets
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/board/widget-tickets.ts
    - scanner: typescript
      file: packages/server-core/src/board/tool-callbacks.ts
    - scanner: typescript
      file: packages/server-core/src/board/widget-store.ts
description: Mints and validates bounded per-mount capability tickets for board widget frames.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/board/tool-callbacks.ts](../../../../../../packages/server-core/src/board/tool-callbacks.ts) | [packages/server-core/src/sessions/SessionManager.ts](../../../../../../packages/server-core/src/sessions/SessionManager.ts) | Invokes supplied callbacks: log, onWidgetMutated | typescript |
