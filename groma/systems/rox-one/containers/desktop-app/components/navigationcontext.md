---
type: C4 Component
title: NavigationContext
status: stable
groma:
  id: navigationcontext
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/contexts/NavigationContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/contexts/NavigationContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/contexts/navigation-reconcile.ts
    - scanner: typescript
      file: apps/electron/src/renderer/contexts/navigation-history.ts
description: Provides typed route navigation, URL-driven history and peer-panel reconciliation for the renderer.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: getDraft, hasDraftAttachments, onAutoDeleteEmptySession, onCreateSession, onInputChange, onSwitchWorkspaceBySlug | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/components/app-shell/ChatDisplay.playground.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.playground.tsx) | Invokes supplied callback: onCreateSession | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/platform/ChatContinuum.playground.tsx](../../../../../../apps/electron/src/renderer/platform/ChatContinuum.playground.tsx) | Invokes supplied callback: onCreateSession | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/platform/MissionBoard.playground.tsx](../../../../../../apps/electron/src/renderer/platform/MissionBoard.playground.tsx) | Invokes supplied callback: onCreateSession | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/playground/demos/mobile-webui/MobilePlaygroundProviders.tsx](../../../../../../apps/electron/src/renderer/playground/demos/mobile-webui/MobilePlaygroundProviders.tsx) | Invokes supplied callback: onCreateSession | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/playground/registry/settings.tsx](../../../../../../apps/electron/src/renderer/playground/registry/settings.tsx) | Invokes supplied callback: onCreateSession | react |
| [apps/electron/src/renderer/contexts/NavigationContext.tsx](../../../../../../apps/electron/src/renderer/contexts/NavigationContext.tsx) | [apps/electron/src/renderer/playground/registry/unified-shell.tsx](../../../../../../apps/electron/src/renderer/playground/registry/unified-shell.tsx) | Invokes supplied callback: onCreateSession | react |
