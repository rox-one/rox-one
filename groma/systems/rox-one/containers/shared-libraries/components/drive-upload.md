---
type: C4 Component
title: Upload
status: stable
groma:
  id: drive-upload
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/drive/upload.ts
    - scanner: typescript
      file: packages/core/src/drive/index.ts
    - scanner: typescript
      file: packages/core/src/drive/commands.ts
    - scanner: typescript
      file: packages/core/src/drive/ledger.ts
    - scanner: typescript
      file: packages/core/src/drive/quota.ts
description: 'Defines the multipart upload protocol: open, complete, abort, part limits, expiry and quota reservation types.'
---
