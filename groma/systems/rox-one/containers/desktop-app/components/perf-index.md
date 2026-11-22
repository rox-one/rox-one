---
type: C4 Component
title: Index
status: stable
groma:
  id: perf-index
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/perf/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/budgets.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/dom-evaluate.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/bundle-profile.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/runner.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/fixtures.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/marks.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/evaluate.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/report.ts
      symbol: formatPerfReport
    - scanner: typescript
      file: apps/electron/src/renderer/perf/switch-sim.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/retained-node-budget.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/surface-sim.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/stats.ts
    - scanner: react
      file: apps/electron/src/renderer/perf/dom-scenario.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/perf/dom-scenario.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/perf/probe.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/dom-fixtures.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/channels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/install.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/dom-budgets.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/observers.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/dom-probe.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/flags.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/prng.ts
      symbol: createPrng
    - scanner: typescript
      file: apps/electron/src/renderer/perf/ipc-counter.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/redaction.ts
    - scanner: typescript
      file: apps/electron/src/renderer/perf/telemetry.ts
description: 'Re-exports the renderer performance harness: budgets, fixtures, telemetry, probes and reports.'
---
