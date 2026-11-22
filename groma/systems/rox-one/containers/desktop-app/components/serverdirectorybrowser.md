---
type: C4 Component
title: ServerDirectoryBrowser
status: stable
groma:
  id: serverdirectorybrowser
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/ServerDirectoryBrowser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ServerDirectoryBrowser.tsx
      symbol: ServerDirectoryBrowser
    - scanner: react
      file: apps/electron/src/renderer/components/KeyboardShortcuts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/KeyboardShortcuts.tsx
      symbol: KeyboardShortcuts
    - scanner: react
      file: apps/electron/src/renderer/components/AppMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/AppMenu.tsx
      symbol: AppMenu
    - scanner: react
      file: apps/electron/src/renderer/components/ResetConfirmationDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ResetConfirmationDialog.tsx
      symbol: ResetConfirmationDialog
    - scanner: react
      file: apps/electron/src/renderer/components/DoctorReportDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/DoctorReportDialog.tsx
      symbol: DoctorReportDialog
    - scanner: react
      file: apps/electron/src/renderer/components/SplashScreen.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/SplashScreen.tsx
      symbol: SplashScreen
    - scanner: react
      file: apps/electron/src/renderer/components/KeyboardShortcutsDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/KeyboardShortcutsDialog.tsx
description: Browses and validates directories on the remote server filesystem in a dialog.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/SplashScreen.tsx](../../../../../../apps/electron/src/renderer/components/SplashScreen.tsx) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callback: onExitComplete | react |
