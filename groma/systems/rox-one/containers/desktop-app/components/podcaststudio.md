---
type: C4 Component
title: PodcastStudio
status: stable
groma:
  id: podcaststudio
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/playbooks/podcast/PodcastStudio.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/podcast/PodcastStudio.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/podcast/podcast-client.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/podcast/podcast-roles.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/playbooks/podcast/podcast-history.ts
description: Generates two-voice podcast episodes from a topic with engine choice, progress and export.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/playbooks/podcast/PodcastStudio.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/podcast/PodcastStudio.tsx) | [apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/PlaybooksHomePage.tsx) | Invokes supplied callback: onCompleted | react |
