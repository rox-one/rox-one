---
type: C4 Component
title: Record
status: stable
groma:
  id: record
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/record.ts
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/bazaar.ts
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/project.ts
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/manifest.ts
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/index.ts
    - scanner: typescript
      file: packages/shared/src/extensions/siyuan-bridge/types.ts
description: Projects SiYuan bridge plugin manifests into extension records and catalog entries with compatibility levels.
---
