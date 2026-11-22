---
type: C4 Component
title: SessionUpload
status: stable
groma:
  id: sessionupload
  parent: viewer
  code:
    - scanner: react
      file: apps/viewer/src/components/SessionUpload.tsx
    - scanner: typescript
      file: apps/viewer/src/components/SessionUpload.tsx
      symbol: SessionUpload
    - scanner: react
      file: apps/viewer/src/components/Header.tsx
    - scanner: typescript
      file: apps/viewer/src/components/Header.tsx
      symbol: Header
    - scanner: typescript
      file: apps/viewer/src/components/index.ts
description: Lets users upload or drop session JSON files into the viewer.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/viewer/src/components/SessionUpload.tsx](../../../../../../apps/viewer/src/components/SessionUpload.tsx) | [apps/viewer/src/App.tsx](../../../../../../apps/viewer/src/App.tsx) | Invokes supplied callback: onSessionLoad | react |

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/viewer/src/components/SessionUpload.tsx](../../../../../../apps/viewer/src/components/SessionUpload.tsx) | [packages/core/src/index.ts](../../../../../../packages/core/src/index.ts) | Uses core types | TypeScript imports |
