---
type: C4 Component
title: Index
status: stable
groma:
  id: server-src-index
  parent: server
  code:
    - scanner: typescript
      file: packages/server/src/index.ts
    - scanner: typescript
      file: packages/server/src/vps-browser-pane-manager.ts
      symbol: VpsBrowserPaneManager
    - scanner: typescript
      file: packages/server/src/handler-deps.ts
  technology: Bun
description: Boots the standalone headless server with token auth, TLS and optional web UI.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server/src/index.ts](../../../../../../packages/server/src/index.ts) | [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | Starts messaging gateway | TypeScript imports |
