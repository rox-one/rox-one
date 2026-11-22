---
type: C4 Component
title: Livekit webhook http
status: stable
groma:
  id: livekit-webhook-http
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/team-chat/livekit-webhook-http.ts
  technology: LiveKit
description: Accepts signed LiveKit webhooks that end team-chat calls and trigger summaries.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [packages/server-core/src/team-chat/livekit-webhook-http.ts](../../../../../../packages/server-core/src/team-chat/livekit-webhook-http.ts) | [packages/server-core/src/bootstrap/headless-start.ts](../../../../../../packages/server-core/src/bootstrap/headless-start.ts) | Invokes supplied callback: onChanged | typescript |
| [packages/server-core/src/team-chat/livekit-webhook-http.ts](../../../../../../packages/server-core/src/team-chat/livekit-webhook-http.ts) | [packages/server-core/src/handlers/rpc/team-chat.ts](../../../../../../packages/server-core/src/handlers/rpc/team-chat.ts) | Invokes supplied callbacks: getStore, onCallEnded | typescript |
