---
type: C4 Component
title: PlaybooksHomePage
status: stable
groma:
  id: playbookshomepage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx
      symbol: PlaybooksHomePage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/notebook-store.ts
description: Hosts the Playbooks notebook list and switches between knowledge, codebook and podcast studio views.
---
