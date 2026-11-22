---
type: C4 Component
title: OAuthConnect
status: stable
groma:
  id: oauthconnect
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/apisetup/OAuthConnect.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/apisetup/OAuthConnect.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/apisetup/tier-models.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/apisetup/submit-helpers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/apisetup/index.ts
description: Collects the OAuth authorization code and surfaces connection errors for provider setup.
---
