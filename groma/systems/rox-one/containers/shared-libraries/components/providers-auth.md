---
type: C4 Component
title: Auth
status: stable
groma:
  id: providers-auth
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/drive/importers/providers/auth.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/providers/onedrive.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/providers/icloud.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/providers/google-drive.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/providers/yandex-disk.ts
description: Persists cloud drive import provider OAuth tokens in the encrypted credential manager with refresh-and-retry.
---
