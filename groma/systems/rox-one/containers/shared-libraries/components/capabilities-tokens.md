---
type: C4 Component
title: Tokens
status: stable
groma:
  id: capabilities-tokens
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/capabilities/tokens.ts
    - scanner: typescript
      file: packages/shared/src/capabilities/packs.ts
    - scanner: typescript
      file: packages/shared/src/capabilities/agents-md.ts
    - scanner: typescript
      file: packages/shared/src/capabilities/index.ts
    - scanner: typescript
      file: packages/shared/src/capabilities/install.ts
description: Estimates token counts per provider family and reconciles estimates against actual usage.
---
