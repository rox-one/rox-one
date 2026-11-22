---
type: C4 Component
title: SessionTableGroupHeader
status: stable
groma:
  id: sessiontablegroupheader
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableGroupHeader.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableGroupHeader.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableHost.tsx
      symbol: SessionTableHost
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/SessionTableRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-empty-groups.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-due.ts
      symbol: isDueOverdue
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-group-chrome.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-drag.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-virtualization.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-table/table-density.ts
description: Renders a collapsible session table group header with context-menu select and expand actions.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/session-table/SessionTableRow.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/session-table/SessionTableRow.tsx) | [apps/electron/src/renderer/playground/registry/collection.tsx](../../../../../../apps/electron/src/renderer/playground/registry/collection.tsx) | Invokes supplied callbacks: onOpen, onSelect, onUpdate | react |
