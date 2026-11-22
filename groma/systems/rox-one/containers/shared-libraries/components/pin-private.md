---
type: C4 Component
title: Pin private
status: stable
groma:
  id: pin-private
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/acl/rules/pin-private.ts
description: ACL rule keeping pin links visible only to their creator and out of backlinks, search and activity.
---
