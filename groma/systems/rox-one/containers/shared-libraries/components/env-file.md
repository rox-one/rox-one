---
type: C4 Component
title: Env file
status: stable
groma:
  id: env-file
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/drive/importers/env-file.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/index.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/job-runner.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/types.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/timeout.ts
    - scanner: typescript
      file: packages/shared/src/drive/importers/r2-target.ts
description: Parses operator KEY=VALUE env files supplying ROX Drive S3 settings when the packaged app has no shell environment.
---
