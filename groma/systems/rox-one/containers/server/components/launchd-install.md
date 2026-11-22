---
type: C4 Component
title: Launchd install
status: stable
groma:
  id: launchd-install
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/service/launchd-install.ts
    - scanner: typescript
      file: packages/server-core/src/service/doctor.ts
    - scanner: typescript
      file: packages/server-core/src/service/app-managed.ts
    - scanner: typescript
      file: packages/server-core/src/service/index.ts
    - scanner: typescript
      file: packages/server-core/src/service/launchd-runtime.ts
    - scanner: typescript
      file: packages/server-core/src/service/node-fs.ts
      symbol: createNodeServiceFilesystem
    - scanner: typescript
      file: packages/server-core/src/service/launchd-plist.ts
    - scanner: typescript
      file: packages/server-core/src/service/onboard-daemon-decision.ts
    - scanner: typescript
      file: packages/server-core/src/service/types.ts
    - scanner: typescript
      file: packages/server-core/src/service/service-manager.ts
  technology: launchd
description: Installs and uninstalls macOS LaunchAgent artifacts transactionally with snapshot rollback.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/service/doctor.ts](../../../../../../packages/server-core/src/service/doctor.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callbacks: getServiceStatus, pathExists | typescript |
