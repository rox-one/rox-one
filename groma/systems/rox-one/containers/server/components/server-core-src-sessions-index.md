---
type: C4 Component
title: Index
status: stable
groma:
  id: server-core-src-sessions-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/sessions/index.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/spawn-env.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/first-session-welcome.ts
      symbol: ensureFirstSessionWelcome
    - scanner: typescript
      file: packages/server-core/src/sessions/__test-config-isolation.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/bulk-labels.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/annotation-payload.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/permission-broker-gate.ts
      symbol: shouldBrokerGatePermission
    - scanner: typescript
      file: packages/server-core/src/sessions/resume-history.ts
      symbol: selectResumeHistory
    - scanner: typescript
      file: packages/server-core/src/sessions/queue-steering.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/RemoteBrowserPaneManager.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/turn-complete.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/archive-guards.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/SessionManager.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/runtime-config.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/share-capability.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/transcript-fence.ts
    - scanner: typescript
      file: packages/server-core/src/sessions/SessionEventBus.ts
description: Barrel re-exporting the session manager, steering queue and transcript fencing modules.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/sessions/share-capability.ts](../../../../../../packages/server-core/src/sessions/share-capability.ts) | [packages/server-core/src/handlers/rpc/native-session-collaboration.ts](../../../../../../packages/server-core/src/handlers/rpc/native-session-collaboration.ts) | Invokes supplied callbacks: getSession, sendEvent | typescript |
