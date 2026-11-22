---
type: C4 Component
title: Metrics store
status: stable
groma:
  id: metrics-store
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/knowledge/metrics-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/daily-notes.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/drafts-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/knowledge-audit.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/siyuan-bootstrap.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/vault-index.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/process-manager.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/knowledge-map.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/change-watcher.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/snapshots-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/proposals-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/local-markdown-provider.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/links-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/notes-migration.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/vault-markdown.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/publication-service.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/g2-status.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/native-notes-provider.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/tool-runtime.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/publications-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/automation-loop-guard.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/siyuan-detect.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/index.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/bridge-service.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/hosting-mode.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/automation-actions.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/notes-import.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/work-envelopes-store.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/siyuan-plugins-fs.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/bridge-registry.ts
    - scanner: typescript
      file: packages/server-core/src/knowledge/connections-store.ts
description: Persists file-backed knowledge usage counters and daily buckets for the knowledge surface.
---
