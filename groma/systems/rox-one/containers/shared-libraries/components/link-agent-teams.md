---
type: C4 Component
title: Link agent teams
status: stable
groma:
  id: link-agent-teams
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/core/src/platform/session-apply/link-agent-teams.ts
      symbol: recordSessionApplyOnTeam
    - scanner: typescript
      file: packages/core/src/platform/session-apply/client.ts
      symbol: SessionApplyClient
    - scanner: typescript
      file: packages/core/src/platform/session-apply/types.ts
    - scanner: typescript
      file: packages/core/src/platform/session-apply/index.ts
description: Records a SessionApply pointer as a task on the workspace AgentTeamsStore.
---
