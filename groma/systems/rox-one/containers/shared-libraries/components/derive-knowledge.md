---
type: C4 Component
title: Derive knowledge
status: stable
groma:
  id: derive-knowledge
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/mindmap/derive-knowledge.ts
    - scanner: typescript
      file: packages/core/src/mindmap/hash.ts
    - scanner: typescript
      file: packages/core/src/mindmap/session-scene-graph.ts
    - scanner: typescript
      file: packages/core/src/mindmap/materialize.ts
    - scanner: typescript
      file: packages/core/src/mindmap/outline.ts
    - scanner: typescript
      file: packages/core/src/mindmap/layout.ts
    - scanner: typescript
      file: packages/core/src/mindmap/derive-note.ts
    - scanner: typescript
      file: packages/core/src/mindmap/session-map-pin.ts
    - scanner: typescript
      file: packages/core/src/mindmap/types.ts
    - scanner: typescript
      file: packages/core/src/mindmap/enrich.ts
    - scanner: typescript
      file: packages/core/src/mindmap/pin.ts
    - scanner: typescript
      file: packages/core/src/mindmap/session-variables.ts
    - scanner: typescript
      file: packages/core/src/mindmap/graph.ts
    - scanner: typescript
      file: packages/core/src/mindmap/session-digest.ts
    - scanner: typescript
      file: packages/core/src/mindmap/derive-session.ts
    - scanner: typescript
      file: packages/core/src/mindmap/index.ts
    - scanner: typescript
      file: packages/core/src/mindmap/pinned-edit.ts
description: Builds a mind-map graph from a knowledge document's outline headings, child blocks and backlinks.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/core/src/mindmap/pin.ts](../../../../../../packages/core/src/mindmap/pin.ts) | [packages/server-core/src/handlers/rpc/mindmap.ts](../../../../../../packages/server-core/src/handlers/rpc/mindmap.ts) | Invokes supplied callbacks: read, write | typescript |
