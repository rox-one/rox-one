---
type: C4 Component
title: Plan
status: stable
groma:
  id: drive-plan
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/drive/plan.ts
    - scanner: typescript
      file: packages/shared/src/drive/types.ts
    - scanner: typescript
      file: packages/shared/src/drive/app-data.ts
    - scanner: typescript
      file: packages/shared/src/drive/index.ts
    - scanner: typescript
      file: packages/shared/src/drive/schemas.ts
description: Computes pure multipart upload part plans, parallel batches and quota progress math for ROX Drive.
---
