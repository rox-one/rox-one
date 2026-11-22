---
type: C4 Component
title: Registry
status: stable
groma:
  id: actions-registry
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/actions/registry.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/actions/registry.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/actions/useAction.ts
      symbol: useAction
    - scanner: typescript
      file: apps/electron/src/renderer/actions/useHotkeyLabel.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/action-flags.ts
      symbol: W1_07_ACTION_FLAG
    - scanner: typescript
      file: apps/electron/src/renderer/actions/definitions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/useVisibleActions.ts
      symbol: useActionsByCategory
    - scanner: typescript
      file: apps/electron/src/renderer/actions/keybinding-context.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/shell-shortcuts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/hotkeys.ts
    - scanner: typescript
      file: apps/electron/src/renderer/actions/index.ts
description: Registers and dispatches app actions with hotkeys, priorities and platform-aware keybinding display.
---
