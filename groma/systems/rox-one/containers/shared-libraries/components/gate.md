---
type: C4 Component
title: Gate
status: stable
groma:
  id: gate
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/rovers-core/src/security/gate.ts
description: Authorization gate restricting container-socket actions by tool class, ownership labels and pinned socket.
---
