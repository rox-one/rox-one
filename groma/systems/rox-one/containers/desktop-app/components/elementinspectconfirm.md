---
type: C4 Component
title: ElementInspectConfirm
status: stable
groma:
  id: elementinspectconfirm
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/browser/ElementInspectConfirm.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/ElementInspectConfirm.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/browser/BrowserTabGlyph.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/BrowserTabGlyph.tsx
      symbol: BrowserTabGlyph
    - scanner: react
      file: apps/electron/src/renderer/components/browser/BrowserTabStrip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/BrowserTabStrip.tsx
      symbol: BrowserTabStrip
    - scanner: react
      file: apps/electron/src/renderer/components/browser/BrowserToolbar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/BrowserToolbar.tsx
      symbol: BrowserToolbar
    - scanner: react
      file: apps/electron/src/renderer/components/browser/NativeSurfacePlaceholder.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/NativeSurfacePlaceholder.tsx
      symbol: NativeSurfacePlaceholder
    - scanner: react
      file: apps/electron/src/renderer/components/browser/BrowserTabStripView.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/BrowserTabStripView.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/browser/BrowserScreen.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/BrowserScreen.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/utils.ts
      symbol: getHostname
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/empty-state-prompts.ts
      symbol: EMPTY_STATE_PROMPT_SAMPLES
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/use-workspace-browser-windows.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/internal-browser-queue.ts
    - scanner: react
      file: apps/electron/src/renderer/components/browser/WorkspaceBrowserRegistry.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/WorkspaceBrowserRegistry.tsx
      symbol: WorkspaceBrowserRegistry
    - scanner: react
      file: apps/electron/src/renderer/components/browser/WebBrowserPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/browser/WebBrowserPanel.tsx
      symbol: WebBrowserPanel
description: Confirms browser element-inspect edits and destructive actions before the agent applies them.
---
