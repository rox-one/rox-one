---
type: C4 Component
title: Lifecycle
status: stable
groma:
  id: lifecycle
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/identity/lifecycle.ts
    - scanner: typescript
      file: packages/core/src/identity/team-chats.ts
    - scanner: typescript
      file: packages/core/src/identity/handle.ts
    - scanner: typescript
      file: packages/core/src/identity/invitation.ts
    - scanner: typescript
      file: packages/core/src/identity/principal.ts
    - scanner: typescript
      file: packages/core/src/identity/index.ts
description: Plans identity lifecycle transitions for invitations, placeholder principals, activation and merge as pure steps.
---
