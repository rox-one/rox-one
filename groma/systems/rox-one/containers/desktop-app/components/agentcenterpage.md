---
type: C4 Component
title: AgentCenterPage
status: stable
groma:
  id: agentcenterpage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx
      symbol: AgentCenterPage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/agents/agent-center-model.ts
description: Lists every waiting, running, stuck and cloud agent run with budget and stop controls.
---
