---
type: C4 Component
title: Jobs
status: stable
groma:
  id: jobs
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/playbooks/jobs.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/assemble.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/episodes.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/script.ts
    - scanner: typescript
      file: packages/server-core/src/playbooks/tts.ts
description: Orchestrates background podcast generation jobs and exposes their start, cancel and playback RPC.
---
