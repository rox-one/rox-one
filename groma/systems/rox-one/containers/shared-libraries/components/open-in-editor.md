---
type: C4 Component
title: Open in editor
status: stable
groma:
  id: open-in-editor
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/workspace/open-in-editor.ts
description: Finds and launches a GUI editor on PATH to open a workspace directory, refusing terminals.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/workspace/open-in-editor.ts](../../../../../../packages/shared/src/workspace/open-in-editor.ts) | [packages/server-core/src/handlers/rpc/workspace.ts](../../../../../../packages/server-core/src/handlers/rpc/workspace.ts) | Invokes supplied callbacks: lookup, spawn | typescript |
