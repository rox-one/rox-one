---
type: C4 Component
title: Register
status: stable
groma:
  id: drive-register
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/drive/register.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/backup-plan.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/upload-queue.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/backup-sources.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/upload-store.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/mirror.ts
    - scanner: typescript
      file: apps/electron/src/main/drive/local-drive.ts
  technology: S3
description: 'Composes the ROX Drive service in main: local engine, cloud import providers and S3 target.'
---
