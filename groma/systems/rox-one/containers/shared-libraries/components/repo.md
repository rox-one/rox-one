---
type: C4 Component
title: Repo
status: stable
groma:
  id: repo
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/memory/repo.ts
    - scanner: typescript
      file: packages/shared/src/memory/git-exec.ts
    - scanner: typescript
      file: packages/shared/src/memory/proposals.ts
    - scanner: typescript
      file: packages/shared/src/memory/context-select.ts
    - scanner: typescript
      file: packages/shared/src/memory/graph-provider.ts
    - scanner: typescript
      file: packages/shared/src/memory/types.ts
    - scanner: typescript
      file: packages/shared/src/memory/learning.ts
    - scanner: typescript
      file: packages/shared/src/memory/document-provenance.ts
description: Defines wire-safe DTOs for the memory repository and dream status shared between server and renderer.
---
