---
type: C4 Component
title: Capabilities
status: stable
groma:
  id: device-capabilities
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/device/capabilities.ts
    - scanner: typescript
      file: packages/shared/src/device/index.ts
description: Maps host-reported permission statuses onto the node capabilities a device may advertise.
---
