---
type: C4 Component
title: Stub runner
status: stable
groma:
  id: cloud-runner-stub-runner
  parent: desktop-app
  code:
    - scanner: javascript
      file: apps/electron/resources/cloud-runner/stub-runner.js
      symbol: setState
description: Stub cloud runner that writes fake subtask artifacts and state events for a run directory.
---
