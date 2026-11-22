---
type: C4 Component
title: Constants
status: stable
groma:
  id: src-automations-constants
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/automations/constants.ts
    - scanner: typescript
      file: packages/shared/src/automations/default-seeds.ts
    - scanner: typescript
      file: packages/shared/src/automations/default-seed-template.ts
    - scanner: typescript
      file: packages/shared/src/automations/cron-matcher.ts
      symbol: matchesCron
    - scanner: typescript
      file: packages/shared/src/automations/webhook-utils.ts
    - scanner: typescript
      file: packages/shared/src/automations/event-logger.ts
    - scanner: typescript
      file: packages/shared/src/automations/sdk-bridge.ts
      symbol: buildEnvFromSdkInput
    - scanner: typescript
      file: packages/shared/src/automations/conditions.ts
    - scanner: typescript
      file: packages/shared/src/automations/automation-system.ts
    - scanner: typescript
      file: packages/shared/src/automations/validation.ts
    - scanner: typescript
      file: packages/shared/src/automations/name-utils.ts
      symbol: deriveAutomationName
    - scanner: typescript
      file: packages/shared/src/automations/utils.ts
    - scanner: typescript
      file: packages/shared/src/automations/history-store.ts
    - scanner: typescript
      file: packages/shared/src/automations/script-executor.ts
    - scanner: typescript
      file: packages/shared/src/automations/schemas.ts
    - scanner: typescript
      file: packages/shared/src/automations/context.ts
    - scanner: typescript
      file: packages/shared/src/automations/graph.ts
    - scanner: typescript
      file: packages/shared/src/automations/conditions-constants.ts
    - scanner: typescript
      file: packages/shared/src/automations/types.ts
    - scanner: typescript
      file: packages/shared/src/automations/event-bus.ts
    - scanner: typescript
      file: packages/shared/src/automations/context-storage.ts
    - scanner: typescript
      file: packages/shared/src/automations/occurrence-ledger.ts
    - scanner: typescript
      file: packages/shared/src/automations/retry-scheduler.ts
    - scanner: typescript
      file: packages/shared/src/automations/resolve-config-path.ts
    - scanner: typescript
      file: packages/shared/src/automations/meeting-followup.ts
    - scanner: typescript
      file: packages/shared/src/automations/security.ts
      symbol: sanitizeForShell
    - scanner: typescript
      file: packages/shared/src/automations/index.ts
description: Defines automation config, history and retry-queue filenames, webhook defaults and history retention caps.
---
