---
type: C4 Component
title: InspectorBrowserPane
status: stable
groma:
  id: inspectorbrowserpane
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/session-inspector/InspectorBrowserPane.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-inspector/InspectorBrowserPane.tsx
      symbol: InspectorBrowserPane
    - scanner: react
      file: apps/electron/src/renderer/components/session-inspector/SessionContextPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-inspector/SessionContextPanel.tsx
      symbol: SessionContextPanel
    - scanner: react
      file: apps/electron/src/renderer/components/session-inspector/SessionInspectorBody.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-inspector/SessionInspectorBody.tsx
      symbol: SessionInspectorBody
    - scanner: react
      file: apps/electron/src/renderer/components/session-inspector/InspectorTerminal.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-inspector/InspectorTerminal.tsx
      symbol: InspectorTerminal
    - scanner: react
      file: apps/electron/src/renderer/components/session-inspector/SessionGitPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/session-inspector/SessionGitPanel.tsx
      symbol: SessionGitPanel
description: Hosts an embedded browser view in the session inspector column with cookie consent handling.
---
