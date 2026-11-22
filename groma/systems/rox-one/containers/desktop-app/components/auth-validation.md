---
type: C4 Component
title: Auth validation
status: stable
groma:
  id: auth-validation
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/utils/auth-validation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/utils/session.ts
    - scanner: typescript
      file: apps/electron/src/renderer/utils/project-colors.ts
    - scanner: typescript
      file: apps/electron/src/renderer/utils/session-families.ts
    - scanner: typescript
      file: apps/electron/src/renderer/utils/session-list-collapse.ts
    - scanner: typescript
      file: apps/electron/src/renderer/utils/text.ts
      symbol: stripMarkdown
description: Validates basic-auth credential fields shared by credential and auth request cards.
---
