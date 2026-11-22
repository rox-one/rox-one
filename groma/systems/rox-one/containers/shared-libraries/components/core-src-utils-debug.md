---
type: C4 Component
title: Debug
status: stable
groma:
  id: core-src-utils-debug
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/utils/debug.ts
      symbol: debug
    - scanner: typescript
      file: packages/core/src/utils/paths.ts
    - scanner: typescript
      file: packages/core/src/utils/index.ts
description: No-op debug logging stub for the core package, deferring to shared debug utilities.
---
