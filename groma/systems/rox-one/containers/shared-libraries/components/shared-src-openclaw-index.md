---
type: C4 Component
title: Index
status: stable
groma:
  id: shared-src-openclaw-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/openclaw/index.ts
    - scanner: typescript
      file: packages/shared/src/openclaw/types.ts
    - scanner: typescript
      file: packages/shared/src/openclaw/audit.ts
description: Barrel re-exporting transport-safe OpenClaw runtime state, audit and error contracts.
---
