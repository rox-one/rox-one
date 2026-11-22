---
type: C4 Component
title: Version
status: stable
groma:
  id: version-version
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/version/version.ts
    - scanner: typescript
      file: packages/shared/src/version/index.ts
    - scanner: typescript
      file: packages/shared/src/version/install.ts
    - scanner: typescript
      file: packages/shared/src/version/manifest.ts
description: Compares the running app version with the latest manifest to decide whether an update exists.
---
