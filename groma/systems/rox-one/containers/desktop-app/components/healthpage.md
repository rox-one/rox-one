---
type: C4 Component
title: HealthPage
status: stable
groma:
  id: healthpage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/health/HealthPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/health/HealthPage.tsx
      symbol: HealthPage
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/health/HealthSections.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/health/HealthSections.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/health/health-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/health/use-health-data.ts
description: Shows a calm health screen of services, providers, MCP servers, syncs and indexes with fixes.
---
