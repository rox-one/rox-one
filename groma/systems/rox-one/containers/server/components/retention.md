---
type: C4 Component
title: Retention
status: stable
groma:
  id: retention
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/meetings/retention.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/security-policy.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/release-gate.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/packaging.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/followup.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/observation-provenance.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/journal.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/outbox.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/query-store.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/session-runtime.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/observe.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/capture.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/summary-heuristic.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/import-media.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/catalog.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/session-transcript-store.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/operation-journal.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/tracker-actions.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/proposal-journal.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/verification.ts
      symbol: verificationLabel
    - scanner: typescript
      file: packages/server-core/src/meetings/note-persist.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/types.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/exports.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/migrations.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/import.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/native-actions.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/rooms.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/summary-cadence.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/sharing.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/index.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/finalize.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/repository.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/observability.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/approve-execute.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/executor.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/manual.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/journal-append.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/queries.ts
    - scanner: typescript
      file: packages/server-core/src/meetings/proposals.ts
description: 'Reports meeting retention honestly: native delete unsupported, external copies stay labelled retained.'
---
