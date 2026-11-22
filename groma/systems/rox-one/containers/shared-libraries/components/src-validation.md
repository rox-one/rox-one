---
type: C4 Component
title: Validation
status: stable
groma:
  id: src-validation
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/session-tools-core/src/validation.ts
    - scanner: typescript
      file: packages/session-tools-core/src/tool-defs-filtering.ts
    - scanner: typescript
      file: packages/session-tools-core/src/index.ts
    - scanner: typescript
      file: packages/session-tools-core/src/types.ts
    - scanner: typescript
      file: packages/session-tools-core/src/source-helpers.ts
    - scanner: typescript
      file: packages/session-tools-core/src/response.ts
    - scanner: typescript
      file: packages/session-tools-core/src/tool-defs.ts
    - scanner: typescript
      file: packages/session-tools-core/src/context.ts
description: Provides shared validation result helpers and schema or YAML checks for session-scoped tools.
---
