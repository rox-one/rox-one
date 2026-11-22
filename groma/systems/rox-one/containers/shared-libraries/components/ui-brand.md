---
type: C4 Component
title: Ui brand
status: stable
groma:
  id: ui-brand
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/identity/ui-brand.ts
    - scanner: typescript
      file: packages/shared/src/identity/schemas.ts
    - scanner: typescript
      file: packages/shared/src/identity/index.ts
    - scanner: typescript
      file: packages/shared/src/identity/github-link.ts
    - scanner: typescript
      file: packages/shared/src/identity/manifest.ts
    - scanner: typescript
      file: packages/shared/src/identity/terms.ts
    - scanner: typescript
      file: packages/shared/src/identity/config-migration.ts
    - scanner: typescript
      file: packages/shared/src/identity/agent-identity.ts
description: Allowlists remaining visible UI brand strings and product titles while protocol and storage IDs stay unchanged.
---
