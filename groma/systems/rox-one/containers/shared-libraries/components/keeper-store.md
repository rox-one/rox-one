---
type: C4 Component
title: Store
status: stable
groma:
  id: keeper-store
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/keeper/store.ts
    - scanner: typescript
      file: packages/shared/src/keeper/index.ts
    - scanner: typescript
      file: packages/shared/src/keeper/crypto.ts
    - scanner: typescript
      file: packages/shared/src/keeper/types.ts
    - scanner: typescript
      file: packages/shared/src/keeper/totp.ts
  technology: AES-256-GCM
description: Persists one encrypted Keeper vault per scope with atomic writes and safeStorage-wrapped keys.
---
