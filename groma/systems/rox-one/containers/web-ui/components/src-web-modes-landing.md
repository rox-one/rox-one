---
type: C4 Component
title: Web modes landing
status: stable
groma:
  id: src-web-modes-landing
  parent: web-ui
  code:
    - scanner: react
      file: apps/webui/src/web-modes-landing.tsx
    - scanner: typescript
      file: apps/webui/src/web-modes-landing.tsx
    - scanner: react
      file: apps/webui/src/App.tsx
    - scanner: typescript
      file: apps/webui/src/App.tsx
      symbol: App
    - scanner: react
      file: apps/webui/src/main.tsx
    - scanner: typescript
      file: apps/webui/src/main.tsx
    - scanner: react
      file: apps/webui/src/browser-main.tsx
    - scanner: typescript
      file: apps/webui/src/browser-main.tsx
    - scanner: react
      file: apps/webui/src/cloud-vm-surface.tsx
    - scanner: typescript
      file: apps/webui/src/cloud-vm-surface.tsx
    - scanner: typescript
      file: apps/webui/src/web-modes.ts
    - scanner: typescript
      file: apps/webui/src/cloud-vm-runs.ts
    - scanner: typescript
      file: apps/webui/src/responsive.ts
      symbol: useIsMobile
    - scanner: typescript
      file: apps/webui/src/jam.ts
    - scanner: typescript
      file: apps/webui/src/rox2-webui-surface.ts
    - scanner: typescript
      file: apps/webui/src/browser-globals.ts
description: Presents the web entry-mode landing for chat and cloud-VM modes.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/webui/src/main.tsx](../../../../../../apps/webui/src/main.tsx) | [packages/server-core/src/index.ts](../../../../../../packages/server-core/src/index.ts) | Loads sessions | HTTP, WebSocket |
| [apps/webui/src/App.tsx](../../../../../../apps/webui/src/App.tsx) | [apps/electron/src/renderer/lib/authenticated-web-bootstrap.ts](../../../../../../apps/electron/src/renderer/lib/authenticated-web-bootstrap.ts) | Imports transport types | TypeScript imports |
| [apps/webui/src/browser-main.tsx](../../../../../../apps/webui/src/browser-main.tsx) | [packages/shared/src/i18n/lazy.ts](../../../../../../packages/shared/src/i18n/lazy.ts) | Loads shared i18n | TypeScript imports |
