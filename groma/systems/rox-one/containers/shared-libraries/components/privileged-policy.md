---
type: C4 Component
title: Privileged policy
status: stable
groma:
  id: privileged-policy
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/agent/core/privileged-policy.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/config-validator.ts
      symbol: ConfigValidator
    - scanner: typescript
      file: packages/shared/src/agent/core/permission-manager.ts
      symbol: PermissionManager
    - scanner: typescript
      file: packages/shared/src/agent/core/session-lifecycle.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/rtk-detector.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/source-manager.ts
      symbol: SourceManager
    - scanner: typescript
      file: packages/shared/src/agent/core/config-watcher-manager.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/agent-budget.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/prerequisite-manager.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/prompt-builder.ts
      symbol: PromptBuilder
    - scanner: typescript
      file: packages/shared/src/agent/core/path-processor.ts
      symbol: PathProcessor
    - scanner: typescript
      file: packages/shared/src/agent/core/pre-tool-use.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/types.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/prompt-tokens.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/index.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/usage-tracker.ts
    - scanner: typescript
      file: packages/shared/src/agent/core/rtk-rewrite.ts
description: Classifies privileged admin commands (brew cask install/upgrade, installer pkg) as the single allowlist policy for approval prompts.
---
