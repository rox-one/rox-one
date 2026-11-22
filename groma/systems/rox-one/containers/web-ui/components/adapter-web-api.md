---
type: C4 Component
title: Web api
status: stable
groma:
  id: adapter-web-api
  parent: web-ui
  code:
    - scanner: typescript
      file: apps/webui/src/adapter/web-api.ts
    - scanner: typescript
      file: apps/webui/src/adapter/transport-bootstrap.ts
description: Implements the browser ElectronAPI over WebSocket RPC with web equivalents for native calls.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/webui/src/adapter/transport-bootstrap.ts](../../../../../../apps/webui/src/adapter/transport-bootstrap.ts) | [apps/webui/src/App.tsx](../../../../../../apps/webui/src/App.tsx) | Invokes supplied callback: createAdapter | typescript |
