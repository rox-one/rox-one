---
type: C4 Component
title: MultiFeed
status: stable
groma:
  id: multifeed
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/MultiFeed.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/MultiFeed.tsx
      symbol: MultiFeed
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/SingleFeed.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/SingleFeed.tsx
      symbol: SingleFeed
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/kit.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/kit.tsx
    - scanner: react
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/parsers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/parsers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/data.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/glance/widgets/net/json-path.ts
description: Merges several remote feeds into one sorted list while keeping per-source caches and polls.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/platform/home/glance/widgets/net/MultiFeed.tsx](../../../../../../apps/electron/src/renderer/platform/home/glance/widgets/net/MultiFeed.tsx) | [apps/electron/src/renderer/platform/home/glance/widgets/TwitchWidget.tsx](../../../../../../apps/electron/src/renderer/platform/home/glance/widgets/TwitchWidget.tsx) | Invokes supplied callback: render | react |
| [apps/electron/src/renderer/platform/home/glance/widgets/net/SingleFeed.tsx](../../../../../../apps/electron/src/renderer/platform/home/glance/widgets/net/SingleFeed.tsx) | [apps/electron/src/renderer/platform/home/glance/widgets/LobstersWidget.tsx](../../../../../../apps/electron/src/renderer/platform/home/glance/widgets/LobstersWidget.tsx) | Invokes supplied callback: parse | react |
