---
type: C4 Component
title: Mail service
status: stable
groma:
  id: mail-service
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/mail/mail-service.ts
    - scanner: typescript
      file: apps/electron/src/main/mail/mail-model.ts
    - scanner: typescript
      file: apps/electron/src/main/mail/local-ipc.ts
  technology: JMAP
description: Manages Rox Mail configuration, mailbox provisioning, mail operations and push in the main process.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/main/mail/local-ipc.ts](../../../../../../apps/electron/src/main/mail/local-ipc.ts) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Invokes supplied callback: isTrustedSender | typescript |
