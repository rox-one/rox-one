---
type: C4 Component
title: Profile native credentials
status: stable
groma:
  id: profile-native-credentials
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/browser/profile-native-credentials.ts
    - scanner: typescript
      file: packages/shared/src/browser/browser-credential-host.ts
    - scanner: typescript
      file: packages/shared/src/browser/index.ts
    - scanner: typescript
      file: packages/shared/src/browser/retained-pane.ts
    - scanner: typescript
      file: packages/shared/src/browser/history-index.ts
    - scanner: typescript
      file: packages/shared/src/browser/element-inspect.ts
    - scanner: typescript
      file: packages/shared/src/browser/profile-import.ts
    - scanner: typescript
      file: packages/shared/src/browser/profile-native-data.ts
    - scanner: typescript
      file: packages/shared/src/browser/history-worker.ts
      symbol: readBrowserHistoryInPool
description: Decrypts and reseals Chromium-saved passwords from a selected browser profile, exporting only ciphertext and counts.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/browser/profile-import.ts](../../../../../../packages/shared/src/browser/profile-import.ts) | [packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts](../../../../../../packages/server-core/src/handlers/rpc/browser-protected-cookie-key.ts) | Invokes supplied callback: deleteKey | typescript |
