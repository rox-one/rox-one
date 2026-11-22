---
type: C4 Component
title: Runtime resolver
status: stable
groma:
  id: runtime-resolver
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/backend/internal/runtime-resolver.ts
    - scanner: typescript
      file: packages/shared/src/agent/backend/internal/driver-types.ts
description: Resolves packaged and development paths for the agent SDK, interceptor and runtime binaries.
---
