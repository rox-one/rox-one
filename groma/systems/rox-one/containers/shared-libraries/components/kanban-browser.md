---
type: C4 Component
title: Browser
status: stable
groma:
  id: kanban-browser
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/kanban/browser.ts
    - scanner: typescript
      file: packages/shared/src/kanban/storage.ts
    - scanner: typescript
      file: packages/shared/src/kanban/types.ts
    - scanner: typescript
      file: packages/shared/src/kanban/config.ts
    - scanner: typescript
      file: packages/shared/src/kanban/index.ts
description: Exports browser-safe Kanban board configuration types, defaults and pure column transforms.
---
