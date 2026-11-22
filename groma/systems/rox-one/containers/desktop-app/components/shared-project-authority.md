---
type: C4 Component
title: Project authority
status: stable
groma:
  id: shared-project-authority
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/shared/project-authority.ts
    - scanner: typescript
      file: apps/electron/src/shared/device-diagnostics.ts
    - scanner: typescript
      file: apps/electron/src/shared/openclaw-host-control.ts
      symbol: OpenClawHostControlApi
    - scanner: typescript
      file: apps/electron/src/shared/extra-screens.ts
    - scanner: typescript
      file: apps/electron/src/shared/types.ts
    - scanner: typescript
      file: apps/electron/src/shared/license-audit-intent.ts
    - scanner: typescript
      file: apps/electron/src/shared/surface-routes.ts
    - scanner: typescript
      file: apps/electron/src/shared/feature-flags.ts
      symbol: FEATURE_FLAGS
    - scanner: typescript
      file: apps/electron/src/shared/cookbooks.ts
    - scanner: typescript
      file: apps/electron/src/shared/home-fetch.ts
    - scanner: typescript
      file: apps/electron/src/shared/settings-presentation.ts
    - scanner: typescript
      file: apps/electron/src/shared/shell-window-lifecycle.ts
    - scanner: typescript
      file: apps/electron/src/shared/calendar-oauth.ts
    - scanner: typescript
      file: apps/electron/src/shared/rail-surfaces.ts
    - scanner: typescript
      file: apps/electron/src/shared/ssh.ts
    - scanner: typescript
      file: apps/electron/src/shared/runtime-map-link.ts
    - scanner: typescript
      file: apps/electron/src/shared/menu-schema.ts
    - scanner: typescript
      file: apps/electron/src/shared/open-design.ts
    - scanner: typescript
      file: apps/electron/src/shared/routes.ts
    - scanner: typescript
      file: apps/electron/src/shared/storage-visible-root.ts
    - scanner: typescript
      file: apps/electron/src/shared/route-parser.ts
    - scanner: typescript
      file: apps/electron/src/shared/entity-routes.ts
    - scanner: typescript
      file: apps/electron/src/shared/render-profile.ts
    - scanner: typescript
      file: apps/electron/src/shared/license-evidence.ts
    - scanner: typescript
      file: apps/electron/src/shared/shell-appearance.ts
    - scanner: typescript
      file: apps/electron/src/shared/meetings-local.ts
    - scanner: typescript
      file: apps/electron/src/shared/remote-tls-client-options.ts
      symbol: peerTrustOptionsForRemote
    - scanner: typescript
      file: apps/electron/src/shared/settings-registry.ts
    - scanner: typescript
      file: apps/electron/src/shared/project-create-intent.ts
    - scanner: typescript
      file: apps/electron/src/shared/mini-glass.ts
      symbol: MINI_GLASS_RESET
    - scanner: typescript
      file: apps/electron/src/shared/page-bridge.ts
    - scanner: typescript
      file: apps/electron/src/shared/mail-local.ts
    - scanner: typescript
      file: apps/electron/src/shared/startup-perf.ts
    - scanner: typescript
      file: apps/electron/src/shared/browser-live-fx.ts
description: Defines the shared-project authority contract and IPC channels linking a local workspace to a remote service.
---
