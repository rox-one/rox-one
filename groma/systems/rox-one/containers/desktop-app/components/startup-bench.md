---
type: C4 Component
title: Startup bench
status: stable
groma:
  id: startup-bench
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/scripts/perf/startup-bench.ts
    - scanner: typescript
      file: apps/electron/scripts/perf/warmup-heap-probe.ts
  technology: Playwright
description: Benchmarks built Electron app startup against window and first-paint budgets.
---
