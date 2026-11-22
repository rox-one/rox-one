---
type: C4 Component
title: App
status: stable
groma:
  id: viewer-src-app
  parent: viewer
  code:
    - scanner: react
      file: apps/viewer/src/App.tsx
    - scanner: typescript
      file: apps/viewer/src/App.tsx
      symbol: App
    - scanner: react
      file: apps/viewer/src/main.tsx
    - scanner: typescript
      file: apps/viewer/src/main.tsx
    - scanner: typescript
      file: apps/viewer/src/rox2-viewer-surface.ts
description: Renders uploaded or shared session transcripts in the web viewer.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/viewer/src/main.tsx](../../../../../../apps/viewer/src/main.tsx) | [packages/server-core/src/index.ts](../../../../../../packages/server-core/src/index.ts) | Uploads transcripts | HTTP |
| [apps/viewer/src/App.tsx](../../../../../../apps/viewer/src/App.tsx) | [packages/ui/src/index.ts](../../../../../../packages/ui/src/index.ts) | Renders shared UI | React |
