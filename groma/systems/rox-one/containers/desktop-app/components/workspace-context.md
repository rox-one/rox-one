---
type: C4 Component
title: Workspace context
status: stable
groma:
  id: workspace-context
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/workspace-context.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/omnibox.ts
      symbol: omniboxOpenAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/header-status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/knowledge-publish.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/extra-screens.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/entities-links.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/collection-display.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/automations.ts
      symbol: automationsAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/skills.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/browser-pane.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/panel-auto-hide.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/overlay.ts
      symbol: fullscreenOverlayOpenAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/projects.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/messaging.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/notify-inbox.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/panel-stack.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/conation-shell.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/playbooks.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/runtime-trace.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/dev-space.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/sessions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/kanban.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/mode-flags.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/panel-workspace.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/messenger-status.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/workbench-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/inbox.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/collection-filters.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/unified-shell.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/sources.ts
      symbol: sourcesAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/siyuan-engine.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/pages.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/workspace-avatar-colors.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/background-finished.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/connections.ts
      symbol: selectedConnectionAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/missions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/se-chat-pip.ts
      symbol: seChatPipOpenAtom
    - scanner: typescript
      file: apps/electron/src/renderer/atoms/side-session.ts
      symbol: sideSessionByWorkspaceAtom
description: Holds the active workspace atom and scopes tool panels to an explicit project.
---
