---
type: C4 Component
title: SecuritySnake
status: stable
groma:
  id: securitysnake
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/settings/security/RoxRuntimeCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/settings/security/RoxRuntimeCard.tsx
      symbol: RoxRuntimeCard
    - scanner: typescript
      file: apps/electron/src/renderer/pages/settings/security/security-validation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/settings/security/security-actions.ts
      symbol: runConfirmedSecurityAction
    - scanner: typescript
      file: apps/electron/src/renderer/pages/settings/security/security-resource.ts
description: Renders the security settings snake grid of domains with coverage, severity and risk direction.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx](../../../../../../apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx) | [apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx) | Invokes supplied callback: onSelectDomain | react |
