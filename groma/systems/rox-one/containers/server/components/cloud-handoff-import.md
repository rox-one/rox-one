---
type: C4 Component
title: Cloud handoff import
status: stable
groma:
  id: cloud-handoff-import
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/bootstrap/cloud-handoff-import.ts
    - scanner: typescript
      file: packages/server-core/src/bootstrap/index.ts
    - scanner: typescript
      file: packages/server-core/src/bootstrap/headless-start.ts
    - scanner: typescript
      file: packages/server-core/src/bootstrap/lock-identity.ts
    - scanner: typescript
      file: packages/server-core/src/bootstrap/init-gated-server.ts
description: Registers an unpacked cloud-handoff workspace and activates its transferred session on headless start.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callbacks: applyPlatformToSubsystems, bindRpcServer, cleanupClientResources, createHandlerDeps, createSessionManager, initModelRefreshService, initializeSessionManager, platformFactory, registerAllRpcHandlers, setSessionEventSink | typescript |
| [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | [packages/server-core/src/handlers/rpc/index.ts](../../../../../../packages/server-core/src/handlers/rpc/index.ts) | Invokes supplied callbacks: cleanupClientResources, registerAllRpcHandlers | typescript |
| [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | [packages/server/src/index.ts](../../../../../../packages/server/src/index.ts) | Invokes supplied callbacks: applyPlatformToSubsystems, bindRpcServer, cleanupSessionManager, createHandlerDeps, createSessionManager, initModelRefreshService, initializeSessionManager, setSessionEventSink | typescript |

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | [packages/shared/src/auth/index.ts](../../../../../../packages/shared/src/auth/index.ts) | Uses shared auth | TypeScript imports |
