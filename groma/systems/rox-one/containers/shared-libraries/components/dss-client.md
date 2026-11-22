---
type: C4 Component
title: Client
status: stable
groma:
  id: dss-client
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/conation/dss/client.ts
    - scanner: typescript
      file: packages/core/src/conation/dss/types.ts
    - scanner: typescript
      file: packages/core/src/conation/dss/paths.ts
    - scanner: typescript
      file: packages/core/src/conation/dss/index.ts
description: Provides a typed HTTP client for listing projects and reading entries from the DSS content service.
---
