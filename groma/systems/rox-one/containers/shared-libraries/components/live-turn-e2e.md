---
type: C4 Component
title: Live turn e2e
status: stable
groma:
  id: live-turn-e2e
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/live-turn-e2e.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-rpc-frames.ts
      symbol: OmpRpcFrameDecoder
    - scanner: typescript
      file: packages/shared/src/agent/knowledge-permissions.ts
    - scanner: typescript
      file: packages/shared/src/agent/claude-llm-query.ts
    - scanner: typescript
      file: packages/shared/src/agent/conversation-summary.ts
    - scanner: typescript
      file: packages/shared/src/agent/browser-tool-runtime.ts
    - scanner: typescript
      file: packages/shared/src/agent/errors.ts
    - scanner: typescript
      file: packages/shared/src/agent/spawn-helpers.ts
    - scanner: typescript
      file: packages/shared/src/agent/thinking-levels.ts
    - scanner: typescript
      file: packages/shared/src/agent/browser-tool-names.ts
    - scanner: typescript
      file: packages/shared/src/agent/source-policy.ts
    - scanner: typescript
      file: packages/shared/src/agent/plan-types.ts
    - scanner: typescript
      file: packages/shared/src/agent/mode-manager.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-history.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-worker-policy.ts
      symbol: OMP_WORKER_POLICY_SOURCE
    - scanner: typescript
      file: packages/shared/src/agent/omp-user-branch.ts
    - scanner: typescript
      file: packages/shared/src/agent/cognitive-profile.ts
    - scanner: typescript
      file: packages/shared/src/agent/base-agent.ts
    - scanner: typescript
      file: packages/shared/src/agent/session-tool-defs.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-first-run.ts
    - scanner: typescript
      file: packages/shared/src/agent/powershell-validator.ts
    - scanner: typescript
      file: packages/shared/src/agent/pi-agent.ts
    - scanner: typescript
      file: packages/shared/src/agent/session-scoped-tool-callback-registry.ts
    - scanner: typescript
      file: packages/shared/src/agent/mode-types.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-model-selection.ts
    - scanner: typescript
      file: packages/shared/src/agent/permissions-config.ts
    - scanner: typescript
      file: packages/shared/src/agent/options.ts
    - scanner: typescript
      file: packages/shared/src/agent/source-activation-drain.ts
    - scanner: typescript
      file: packages/shared/src/agent/claude-sdk-error-mapper.ts
    - scanner: typescript
      file: packages/shared/src/agent/index.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-runtime-trace-bridge.ts
      symbol: OmpRuntimeTraceBridge
    - scanner: typescript
      file: packages/shared/src/agent/spawn-session-tool.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-agent.ts
    - scanner: typescript
      file: packages/shared/src/agent/diagnostics.ts
    - scanner: typescript
      file: packages/shared/src/agent/claude-context.ts
    - scanner: typescript
      file: packages/shared/src/agent/live-turn-gate.ts
    - scanner: typescript
      file: packages/shared/src/agent/agent-run-registry.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-native-policy.ts
    - scanner: typescript
      file: packages/shared/src/agent/permission-shadow-review.ts
    - scanner: typescript
      file: packages/shared/src/agent/claude-agent.ts
    - scanner: typescript
      file: packages/shared/src/agent/session-scoped-tools.ts
    - scanner: typescript
      file: packages/shared/src/agent/tool-matching.ts
    - scanner: typescript
      file: packages/shared/src/agent/llm-tool.ts
    - scanner: typescript
      file: packages/shared/src/agent/browser-tools.ts
    - scanner: typescript
      file: packages/shared/src/agent/omp-rpc-transport.ts
    - scanner: typescript
      file: packages/shared/src/agent/model-fallback-status.ts
    - scanner: typescript
      file: packages/shared/src/agent/session-self-management-bindings.ts
      symbol: attachSessionSelfManagementBindings
    - scanner: typescript
      file: packages/shared/src/agent/omp-runtime-observer.ts
    - scanner: typescript
      file: packages/shared/src/agent/bash-validator.ts
    - scanner: typescript
      file: packages/shared/src/agent/context-budget.ts
description: Prints the live-turn verification gate status for the current process environment as a CLI diagnostic runner.
---
