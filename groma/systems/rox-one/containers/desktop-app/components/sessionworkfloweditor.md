---
type: C4 Component
title: SessionWorkflowEditor
status: stable
groma:
  id: sessionworkfloweditor
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/PlaybookHoleList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/PlaybookHoleList.tsx
      symbol: PlaybookHoleList
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SessionGitOutline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SessionGitOutline.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SessionFanOutSheet.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SessionFanOutSheet.tsx
      symbol: SessionFanOutSheet
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SceneNode.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SceneNode.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/RepoArchitectureExplainer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/RepoArchitectureExplainer.tsx
      symbol: RepoArchitectureExplainer
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SessionFlowCanvas.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SessionFlowCanvas.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/RightSessionShell.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/RightSessionShell.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/session-workbench/SessionWorkbench.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/SessionWorkbench.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/canvas-interactions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/holes-from-scene.ts
      symbol: holesFromScene
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/canvas-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/to-flow-elements.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/map-connection-rules.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/map-toolbar-density.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/fan-out-jobs.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/draft-nodes.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/map-node-size.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/right-session-shell.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/canvas-node-editing.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/node-kinds.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/scene-tools.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/map-empty-actions.ts
      symbol: isSessionMapEmpty
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-workbench/workflow-document.ts
  technology: React Flow
description: Edits a session's workflow map on a React Flow canvas with scene, draft and sticky nodes.
---
