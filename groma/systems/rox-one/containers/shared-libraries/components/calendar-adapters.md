---
type: C4 Component
title: Adapters
status: stable
groma:
  id: calendar-adapters
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/calendar/adapters.ts
    - scanner: typescript
      file: packages/core/src/calendar/occurrences.ts
    - scanner: typescript
      file: packages/core/src/calendar/capabilities.ts
    - scanner: typescript
      file: packages/core/src/calendar/store.ts
    - scanner: typescript
      file: packages/core/src/calendar/index.ts
    - scanner: typescript
      file: packages/core/src/calendar/merge.ts
    - scanner: typescript
      file: packages/core/src/calendar/apple-calendar-adapter.ts
    - scanner: typescript
      file: packages/core/src/calendar/types.ts
    - scanner: typescript
      file: packages/core/src/calendar/google-calendar-adapter.ts
description: Selects fixture, unavailable or live calendar adapters for Apple and Google providers behind one listing interface.
---
