---
type: C4 Component
title: Types
status: stable
groma:
  id: privacy-types
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/privacy/types.ts
    - scanner: typescript
      file: packages/shared/src/privacy/policy.ts
    - scanner: typescript
      file: packages/shared/src/privacy/store.ts
    - scanner: typescript
      file: packages/shared/src/privacy/index.ts
    - scanner: typescript
      file: packages/shared/src/privacy/replica-consent.ts
      symbol: applyConsentToReplica
description: Defines product-data consent purposes, append-only consent events, export and deletion receipt types.
---
