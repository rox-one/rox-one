---
type: C4 Component
title: Reminder
status: stable
groma:
  id: reminder
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/xfn/reminder.ts
    - scanner: typescript
      file: packages/core/src/xfn/commands.ts
    - scanner: typescript
      file: packages/core/src/xfn/index.ts
    - scanner: typescript
      file: packages/core/src/xfn/ports.ts
description: Defines the reminder record with an entity subjectRef and scheduling helpers that emit reminder_due notifications.
---
