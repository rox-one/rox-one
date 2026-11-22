---
type: C4 Component
title: Markdown commit
status: stable
groma:
  id: markdown-commit
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/docs/markdown-commit.ts
    - scanner: typescript
      file: packages/server-core/src/docs/block-tree-service.ts
    - scanner: typescript
      file: packages/server-core/src/docs/descriptor-resolver.ts
    - scanner: typescript
      file: packages/server-core/src/docs/legacy-markdown-migration-fence.ts
    - scanner: typescript
      file: packages/server-core/src/docs/note-revision-history.ts
description: Commits Markdown notes durably through a journaled, revision-checked write pipeline.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/docs/block-tree-service.ts](../../../../../../packages/server-core/src/docs/block-tree-service.ts) | [packages/server-core/src/handlers/rpc/content.ts](../../../../../../packages/server-core/src/handlers/rpc/content.ts) | Invokes supplied callbacks: commit, resolve | typescript |
