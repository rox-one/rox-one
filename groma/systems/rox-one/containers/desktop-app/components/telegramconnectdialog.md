---
type: C4 Component
title: TelegramConnectDialog
status: stable
groma:
  id: telegramconnectdialog
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/TelegramConnectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/TelegramConnectDialog.tsx
      symbol: TelegramConnectDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/MessagingPlatformIcon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/MessagingPlatformIcon.tsx
      symbol: MessagingPlatformIcon
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/MessagingSessionMenuItem.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/MessagingSessionMenuItem.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/PairingCodeDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/PairingCodeDialog.tsx
      symbol: PairingCodeDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/TelegramSupergroupPairingDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/TelegramSupergroupPairingDialog.tsx
      symbol: TelegramSupergroupPairingDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/WeChatConnectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/WeChatConnectDialog.tsx
      symbol: WeChatConnectDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/MessagingDialogHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/MessagingDialogHost.tsx
      symbol: MessagingDialogHost
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/LarkConnectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/LarkConnectDialog.tsx
      symbol: LarkConnectDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/DiscordConnectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/DiscordConnectDialog.tsx
      symbol: DiscordConnectDialog
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/WhatsAppConnectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/WhatsAppConnectDialog.tsx
      symbol: WhatsAppConnectDialog
description: Pairs a Telegram bot by pasting and testing a BotFather token in a modal.
---
