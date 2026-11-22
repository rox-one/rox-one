---
type: C4 Component
title: Index
status: stable
groma:
  id: server-core-src-domain-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/domain/index.ts
    - scanner: typescript
      file: packages/server-core/src/domain/session-browser-release.ts
    - scanner: typescript
      file: packages/server-core/src/domain/init-gate.ts
      symbol: InitGate
    - scanner: typescript
      file: packages/server-core/src/domain/title-sanitizer.ts
      symbol: sanitizeForTitle
    - scanner: typescript
      file: packages/server-core/src/domain/browser-tool-detection.ts
    - scanner: typescript
      file: packages/server-core/src/domain/session-branch-cleanup.ts
    - scanner: typescript
      file: packages/server-core/src/domain/connection-setup-logic.ts
description: Barrel re-exporting domain helpers for titles, browser-tool detection, init gating and session cleanup.
---
