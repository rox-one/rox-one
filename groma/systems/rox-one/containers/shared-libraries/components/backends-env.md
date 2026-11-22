---
type: C4 Component
title: Env
status: stable
groma:
  id: backends-env
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/credentials/backends/env.ts
      symbol: EnvironmentBackend
    - scanner: typescript
      file: packages/shared/src/credentials/backends/secure-storage.ts
    - scanner: typescript
      file: packages/shared/src/credentials/backends/keychain-master-key.ts
    - scanner: typescript
      file: packages/shared/src/credentials/backends/types.ts
description: Disabled credential backend placeholder that would read API keys from environment variables.
---
