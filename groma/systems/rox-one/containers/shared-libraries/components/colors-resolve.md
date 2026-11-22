---
type: C4 Component
title: Resolve
status: stable
groma:
  id: colors-resolve
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/colors/resolve.ts
    - scanner: typescript
      file: packages/shared/src/colors/index.ts
    - scanner: typescript
      file: packages/shared/src/colors/defaults.ts
    - scanner: typescript
      file: packages/shared/src/colors/migrate.ts
    - scanner: typescript
      file: packages/shared/src/colors/types.ts
    - scanner: typescript
      file: packages/shared/src/colors/validate.ts
description: Resolves entity color config values into CSS color strings, honoring light and dark themes plus opacity.
---
