---
type: C4 Component
title: Scheduler service
status: stable
groma:
  id: scheduler-service
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/scheduler/scheduler-service.ts
    - scanner: typescript
      file: packages/shared/src/scheduler/index.ts
description: Emits a minute-aligned scheduler tick that automations subscribe to via cron expressions.
---
