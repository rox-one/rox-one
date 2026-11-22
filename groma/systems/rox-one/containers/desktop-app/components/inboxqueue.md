---
type: C4 Component
title: InboxQueue
status: stable
groma:
  id: inboxqueue
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/inbox/InboxQueue.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/InboxQueue.tsx
      symbol: InboxQueue
    - scanner: react
      file: apps/electron/src/renderer/pages/inbox/InboxSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/InboxSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/inbox-model.ts
description: Renders the unified Входящие queue of pending approvals, plans, proposals and unread agent replies.
---
