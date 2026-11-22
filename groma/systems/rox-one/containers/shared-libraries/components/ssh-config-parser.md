---
type: C4 Component
title: Ssh config parser
status: stable
groma:
  id: ssh-config-parser
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/config/ssh-config-parser.ts
    - scanner: typescript
      file: packages/shared/src/config/ssh-hosts.ts
    - scanner: typescript
      file: packages/shared/src/config/cli-domains.ts
    - scanner: typescript
      file: packages/shared/src/config/isolated-config-env.ts
      symbol: isolatedConfigEnv
    - scanner: typescript
      file: packages/shared/src/config/index.ts
    - scanner: typescript
      file: packages/shared/src/config/theme-id.ts
      symbol: isSafeThemeId
    - scanner: typescript
      file: packages/shared/src/config/models-pi.ts
    - scanner: typescript
      file: packages/shared/src/config/theme-layers-schema.ts
    - scanner: typescript
      file: packages/shared/src/config/llm-validation.ts
    - scanner: typescript
      file: packages/shared/src/config/env.ts
    - scanner: typescript
      file: packages/shared/src/config/types.ts
      symbol: NetworkProxySettings
    - scanner: typescript
      file: packages/shared/src/config/watcher.ts
    - scanner: typescript
      file: packages/shared/src/config/paths.ts
      symbol: CONFIG_DIR
    - scanner: typescript
      file: packages/shared/src/config/sync-craft-agent-bash-patterns.ts
    - scanner: typescript
      file: packages/shared/src/config/llm-connections.ts
    - scanner: typescript
      file: packages/shared/src/config/config-defaults-schema.ts
      symbol: ConfigDefaults
    - scanner: typescript
      file: packages/shared/src/config/server-services.ts
    - scanner: typescript
      file: packages/shared/src/config/owned-root-policy.ts
    - scanner: typescript
      file: packages/shared/src/config/models.ts
    - scanner: typescript
      file: packages/shared/src/config/theme.ts
    - scanner: typescript
      file: packages/shared/src/config/proxy-env.ts
      symbol: getProxyEnvVars
    - scanner: typescript
      file: packages/shared/src/config/legacy-config-migration.ts
    - scanner: typescript
      file: packages/shared/src/config/preferences.ts
    - scanner: typescript
      file: packages/shared/src/config/storage.ts
    - scanner: typescript
      file: packages/shared/src/config/model-fetcher.ts
    - scanner: typescript
      file: packages/shared/src/config/provider-metadata.ts
    - scanner: typescript
      file: packages/shared/src/config/theme-layers.ts
    - scanner: typescript
      file: packages/shared/src/config/remote-tls-trust.ts
      symbol: normalizeRemoteTlsTrust
    - scanner: typescript
      file: packages/shared/src/config/rox-public-models.ts
    - scanner: typescript
      file: packages/shared/src/config/server-config.ts
    - scanner: typescript
      file: packages/shared/src/config/kimi-coding.ts
    - scanner: typescript
      file: packages/shared/src/config/validators.ts
description: Parses ~/.ssh/config into non-wildcard host suggestions for importing SSH connections into the workspace.
---
