---
type: C4 Component
title: ChannelInfoPanel
status: stable
groma:
  id: channelinfopanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/messenger/ChannelInfoPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/ChannelInfoPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/messenger/CallStage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/CallStage.tsx
      symbol: CallStage
    - scanner: react
      file: apps/electron/src/renderer/components/messenger/MessengerListSkeleton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/MessengerListSkeleton.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/messenger/MessengerChannels.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/MessengerChannels.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/messenger/message-cards.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/message-cards.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/use-im-relay.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/im-message-map.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/use-team-chat.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/messenger/use-team-call.ts
description: Shows a team channel's card, active call, stats and member presence in a side panel.
---
