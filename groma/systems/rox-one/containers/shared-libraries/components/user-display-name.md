---
type: C4 Component
title: User display name
status: stable
groma:
  id: user-display-name
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/os/user-display-name.ts
description: Resolves the OS user's real name and machine hostname for onboarding profile seeding.
---
