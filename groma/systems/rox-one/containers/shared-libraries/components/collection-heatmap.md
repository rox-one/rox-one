---
type: C4 Component
title: Collection heatmap
status: stable
groma:
  id: collection-heatmap
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/sessions/collection-heatmap.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-types.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-convert.ts
    - scanner: typescript
      file: packages/shared/src/sessions/lexorank.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-persist.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-progress.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-metrics.ts
    - scanner: typescript
      file: packages/shared/src/sessions/types.ts
    - scanner: typescript
      file: packages/shared/src/sessions/session-load-cache.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-home.ts
    - scanner: typescript
      file: packages/shared/src/sessions/word-lists.ts
    - scanner: typescript
      file: packages/shared/src/sessions/validation.ts
    - scanner: typescript
      file: packages/shared/src/sessions/jsonl.ts
    - scanner: typescript
      file: packages/shared/src/sessions/membership.ts
    - scanner: typescript
      file: packages/shared/src/sessions/storage.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-display-storage.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-filters-storage.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-discover.ts
    - scanner: typescript
      file: packages/shared/src/sessions/persistence-queue.ts
    - scanner: typescript
      file: packages/shared/src/sessions/import-registry.ts
    - scanner: typescript
      file: packages/shared/src/sessions/atomic-replace.ts
    - scanner: typescript
      file: packages/shared/src/sessions/bundle.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-query.ts
    - scanner: typescript
      file: packages/shared/src/sessions/internal-prompts.ts
    - scanner: typescript
      file: packages/shared/src/sessions/session-tokens.ts
    - scanner: typescript
      file: packages/shared/src/sessions/journal-primary.ts
    - scanner: typescript
      file: packages/shared/src/sessions/utils.ts
      symbol: pickSessionFields
    - scanner: typescript
      file: packages/shared/src/sessions/slug-generator.ts
    - scanner: typescript
      file: packages/shared/src/sessions/journal-shadow.ts
    - scanner: typescript
      file: packages/shared/src/sessions/index.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-types.ts
    - scanner: typescript
      file: packages/shared/src/sessions/collection-agent-family.ts
    - scanner: typescript
      file: packages/shared/src/sessions/journal-recover.ts
      symbol: recoverSessionJournal
description: Computes GitHub-style yearly activity heatmaps and per-session duration metrics for the sessions collection browser.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/sessions/import-persist.ts](../../../../../../packages/shared/src/sessions/import-persist.ts) | [packages/server-core/src/handlers/rpc/session-foreign-auto-import.ts](../../../../../../packages/server-core/src/handlers/rpc/session-foreign-auto-import.ts) | Invokes supplied callback: onBatch | typescript |
| [packages/shared/src/sessions/import-persist.ts](../../../../../../packages/shared/src/sessions/import-persist.ts) | [packages/server-core/src/handlers/rpc/session-foreign-import.ts](../../../../../../packages/server-core/src/handlers/rpc/session-foreign-import.ts) | Invokes supplied callback: onBatch | typescript |
