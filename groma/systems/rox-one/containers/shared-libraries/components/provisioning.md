---
type: C4 Component
title: Provisioning
status: stable
groma:
  id: provisioning
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/mail/provisioning.ts
    - scanner: typescript
      file: packages/shared/src/mail/handle.ts
    - scanner: typescript
      file: packages/shared/src/mail/index.ts
    - scanner: typescript
      file: packages/shared/src/mail/jmap-client.ts
    - scanner: typescript
      file: packages/shared/src/mail/stalwart-admin.ts
  technology: JMAP, Stalwart
description: 'Provisions Rox mailboxes idempotently: handle selection, account creation, app-password minting and JMAP verification.'
---
