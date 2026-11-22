---
type: C4 Component
title: Index
status: stable
groma:
  id: cli-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/cli/index.ts
    - scanner: typescript
      file: packages/shared/src/cli/command-catalog.ts
    - scanner: typescript
      file: packages/shared/src/cli/parity-matrix.ts
description: Barrel re-exporting the ROX CLI command catalog, slash resolution helpers and parity matrix.
---
