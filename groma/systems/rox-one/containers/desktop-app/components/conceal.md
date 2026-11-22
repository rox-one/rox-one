---
type: C4 Component
title: Conceal
status: stable
groma:
  id: conceal
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/clipboard-history/conceal.ts
    - scanner: typescript
      file: apps/electron/src/main/clipboard-history/store.ts
    - scanner: typescript
      file: apps/electron/src/main/clipboard-history/shortcut.ts
    - scanner: typescript
      file: apps/electron/src/main/clipboard-history/monitor.ts
description: Writes first-party secret copies to the clipboard tagged as concealed so managers skip them.
---
