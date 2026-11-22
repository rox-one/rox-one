---
type: C4 Component
title: Local
status: stable
groma:
  id: home-fetch-local
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/home-fetch/local.ts
    - scanner: typescript
      file: apps/electron/src/main/home-fetch/shared-keys.ts
    - scanner: typescript
      file: apps/electron/src/main/home-fetch/service.ts
    - scanner: typescript
      file: apps/electron/src/main/home-fetch/ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/home-fetch/url-guard.ts
description: Reads this machine's CPU, disk and docker container stats for Home widgets.
---
