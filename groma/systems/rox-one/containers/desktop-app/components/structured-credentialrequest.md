---
type: C4 Component
title: CredentialRequest
status: stable
groma:
  id: structured-credentialrequest
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/structured/CredentialRequest.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/structured/CredentialRequest.tsx
      symbol: CredentialRequest
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/structured/AdminApprovalRequest.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/structured/AdminApprovalRequest.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest.tsx
      symbol: PermissionRequest
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/input/structured/types.ts
description: Collects bearer, basic, header or query credentials from the user for agent tool authentication requests.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/input/structured/AdminApprovalRequest.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/structured/AdminApprovalRequest.tsx) | [apps/electron/src/renderer/components/app-shell/input/StructuredInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/StructuredInput.tsx) | Invokes supplied callback: onApprove | react |
