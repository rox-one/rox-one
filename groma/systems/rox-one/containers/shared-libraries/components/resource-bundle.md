---
type: C4 Component
title: Resource bundle
status: stable
groma:
  id: resource-bundle
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/resources/resource-bundle.ts
    - scanner: typescript
      file: packages/shared/src/resources/index.ts
    - scanner: typescript
      file: packages/shared/src/resources/types.ts
description: Exports and imports workspace sources, skills and automations as sanitized portable bundles.
---
