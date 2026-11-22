---
type: C4 Component
title: Native replica
status: stable
groma:
  id: main-native-replica
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/native-replica.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-cookie-auto-import.ts
    - scanner: typescript
      file: apps/electron/src/main/openclaw-security.ts
    - scanner: typescript
      file: apps/electron/src/main/project-create-intent.ts
    - scanner: typescript
      file: apps/electron/src/main/page-thumbnail-host.ts
    - scanner: typescript
      file: apps/electron/src/main/bootstrap-window-workspace.ts
      symbol: readBoundWindowWorkspace
    - scanner: typescript
      file: apps/electron/src/main/thumbnail-protocol.ts
    - scanner: typescript
      file: apps/electron/src/main/network-proxy.ts
    - scanner: typescript
      file: apps/electron/src/main/app-icon-paths.ts
    - scanner: typescript
      file: apps/electron/src/main/brand-icon-migration.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-pane-manager.ts
    - scanner: typescript
      file: apps/electron/src/main/storage-visible-root-ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/numbered-user-data.ts
      symbol: resolveNumberedUserDataDir
    - scanner: typescript
      file: apps/electron/src/main/knowledge-engine-session.ts
    - scanner: typescript
      file: apps/electron/src/main/menu.ts
    - scanner: typescript
      file: apps/electron/src/main/server-endpoint-policy.ts
    - scanner: typescript
      file: apps/electron/src/main/windows-bootstrap.ts
    - scanner: typescript
      file: apps/electron/src/main/server-host.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-cookie-crypto.ts
    - scanner: typescript
      file: apps/electron/src/main/index.ts
    - scanner: typescript
      file: apps/electron/src/main/quit-exit-guard.ts
      symbol: runQuitCleanupThenExit
    - scanner: typescript
      file: apps/electron/src/main/shell-material.ts
    - scanner: typescript
      file: apps/electron/src/main/surface-routes-ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/device-diagnostics-ipc.ts
      symbol: registerDeviceDiagnosticsIpc
    - scanner: typescript
      file: apps/electron/src/main/remote-tls-enrollment.ts
    - scanner: typescript
      file: apps/electron/src/main/spawn-env-preparation.ts
      symbol: startSpawnEnvPreparation
    - scanner: typescript
      file: apps/electron/src/main/service-lifecycle-ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/shell-env.ts
    - scanner: typescript
      file: apps/electron/src/main/brand-config-boot.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-credential-permissions.ts
    - scanner: typescript
      file: apps/electron/src/main/power-manager.ts
    - scanner: typescript
      file: apps/electron/src/main/deep-link.ts
    - scanner: typescript
      file: apps/electron/src/main/tray-badge.ts
    - scanner: typescript
      file: apps/electron/src/main/network-proxy-utils.ts
    - scanner: typescript
      file: apps/electron/src/main/page-thumbnailer.ts
    - scanner: typescript
      file: apps/electron/src/main/mini-glass.ts
    - scanner: typescript
      file: apps/electron/src/main/native-transport-credential.ts
    - scanner: typescript
      file: apps/electron/src/main/canvas-ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/render-profile.ts
    - scanner: typescript
      file: apps/electron/src/main/worker-pool-setup.ts
      symbol: setupWorkerPool
    - scanner: typescript
      file: apps/electron/src/main/browser-credential-vault-keys.ts
    - scanner: typescript
      file: apps/electron/src/main/system-accent.ts
    - scanner: typescript
      file: apps/electron/src/main/renderer-session-policy.ts
    - scanner: typescript
      file: apps/electron/src/main/global-input-router.ts
    - scanner: typescript
      file: apps/electron/src/main/window-manager.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-pane-session.ts
      symbol: BROWSER_PANE_SESSION_PARTITION
    - scanner: typescript
      file: apps/electron/src/main/mini-glass-geometry.ts
    - scanner: typescript
      file: apps/electron/src/main/cookbooks-runtime.ts
    - scanner: typescript
      file: apps/electron/src/main/auto-update.ts
    - scanner: typescript
      file: apps/electron/src/main/tray.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-cdp.ts
    - scanner: typescript
      file: apps/electron/src/main/quick-composer.ts
    - scanner: typescript
      file: apps/electron/src/main/visible-home-boot.ts
    - scanner: typescript
      file: apps/electron/src/main/onboarding-permissions.ts
    - scanner: typescript
      file: apps/electron/src/main/entities-flags.ts
    - scanner: typescript
      file: apps/electron/src/main/device-diagnostics-collector.ts
    - scanner: typescript
      file: apps/electron/src/main/project-authority.ts
    - scanner: typescript
      file: apps/electron/src/main/zed-themes-import.ts
    - scanner: typescript
      file: apps/electron/src/main/logger.ts
    - scanner: typescript
      file: apps/electron/src/main/openclaw-host-control.ts
    - scanner: typescript
      file: apps/electron/src/main/notifications.ts
    - scanner: typescript
      file: apps/electron/src/main/node-mode.ts
    - scanner: typescript
      file: apps/electron/src/main/shell-actions.ts
      symbol: dispatchShellAction
    - scanner: typescript
      file: apps/electron/src/main/platform.ts
    - scanner: typescript
      file: apps/electron/src/main/configuration-cli-compat.ts
      symbol: validateConfigurationCliEntries
    - scanner: typescript
      file: apps/electron/src/main/extension-host-manager.ts
    - scanner: typescript
      file: apps/electron/src/main/open-design-window.ts
    - scanner: typescript
      file: apps/electron/src/main/startup-marks.ts
    - scanner: typescript
      file: apps/electron/src/main/quicklook.ts
    - scanner: typescript
      file: apps/electron/src/main/chunked-rpc.ts
    - scanner: typescript
      file: apps/electron/src/main/pocket-account-store.ts
      symbol: createPocketAccountStore
    - scanner: typescript
      file: apps/electron/src/main/local-client-binding.ts
    - scanner: javascript
      file: apps/electron/src/main/boot.cjs
    - scanner: typescript
      file: apps/electron/src/main/auto-update-policy.ts
    - scanner: typescript
      file: apps/electron/src/main/manual-release-update.ts
    - scanner: typescript
      file: apps/electron/src/main/project-authority-journal.ts
    - scanner: typescript
      file: apps/electron/src/main/native-replica-bootstrap.ts
    - scanner: typescript
      file: apps/electron/src/main/open-design-runtime.ts
    - scanner: typescript
      file: apps/electron/src/main/files-actions.ts
    - scanner: typescript
      file: apps/electron/src/main/window-state.ts
    - scanner: typescript
      file: apps/electron/src/main/desktop-bridge.ts
  technology: SQLite
description: Hosts the main-process native account-data replica with an encrypted SQLite outbox and IPC surface.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [omp-runtime](../../../../../externals/omp-runtime.md) | Executes agent sessions | NDJSON RPC |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [llm-providers](../../../../../externals/llm-providers.md) | Calls models | HTTPS |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [github](../../../../../externals/github.md) | Checks releases | HTTPS |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [packages/server-core/src/index.ts](../../../../../../packages/server-core/src/index.ts) | Hosts server | in-process |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [packages/shared/src/index.ts](../../../../../../packages/shared/src/index.ts) | Uses shared runtime | TypeScript imports |
| [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | [packages/messaging-gateway/src/index.ts](../../../../../../packages/messaging-gateway/src/index.ts) | Starts messaging gateway | TypeScript imports |
