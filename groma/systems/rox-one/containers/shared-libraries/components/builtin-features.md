---
type: C4 Component
title: Builtin features
status: stable
groma:
  id: builtin-features
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/extensions/builtin-features.ts
    - scanner: typescript
      file: packages/shared/src/extensions/catalog.ts
    - scanner: typescript
      file: packages/shared/src/extensions/center-groups.ts
    - scanner: typescript
      file: packages/shared/src/extensions/marketplace-kind.ts
    - scanner: typescript
      file: packages/shared/src/extensions/index.ts
    - scanner: typescript
      file: packages/shared/src/extensions/activation.ts
    - scanner: typescript
      file: packages/shared/src/extensions/types.ts
    - scanner: typescript
      file: packages/shared/src/extensions/installed-counts.ts
      symbol: countInstalledExtensionRecords
    - scanner: typescript
      file: packages/shared/src/extensions/permissions.ts
    - scanner: typescript
      file: packages/shared/src/extensions/browser.ts
    - scanner: typescript
      file: packages/shared/src/extensions/manifest.ts
    - scanner: typescript
      file: packages/shared/src/extensions/state-store.ts
    - scanner: typescript
      file: packages/shared/src/extensions/community-registries.ts
    - scanner: typescript
      file: packages/shared/src/extensions/default-install.ts
description: Declares Rox's first-party craft-native extension records (clipboard history, knowledge map) shown in the Extension Center.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/shared/src/extensions/activation.ts](../../../../../../packages/shared/src/extensions/activation.ts) | [apps/electron/src/main/extension-host/startup.ts](../../../../../../apps/electron/src/main/extension-host/startup.ts) | Invokes supplied callback: enabled | typescript |
