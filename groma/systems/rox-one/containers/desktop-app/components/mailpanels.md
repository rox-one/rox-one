---
type: C4 Component
title: MailPanels
status: stable
groma:
  id: mailpanels
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/mail/mail-sanitize.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/mail/mail-view.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/inbox/mail/useMail.ts
description: 'Renders the Входящие mail surface: address and folders, message list, reader and compose.'
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx](../../../../../../apps/electron/src/renderer/pages/inbox/mail/MailPanels.tsx) | [apps/electron/src/renderer/pages/inbox/InboxQueue.tsx](../../../../../../apps/electron/src/renderer/pages/inbox/InboxQueue.tsx) | Invokes supplied callbacks: onClose, onCompose, onSelect | react |
