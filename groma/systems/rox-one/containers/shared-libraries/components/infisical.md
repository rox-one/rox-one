---
type: C4 Component
title: Infisical
status: stable
groma:
  id: infisical
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/secrets/providers/infisical.ts
    - scanner: typescript
      file: packages/shared/src/secrets/providers/environment.ts
    - scanner: typescript
      file: packages/shared/src/secrets/providers/local.ts
description: Resolves secrets from the Infisical REST API with typed failures and a short success cache.
---
