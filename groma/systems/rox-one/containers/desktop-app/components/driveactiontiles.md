---
type: C4 Component
title: DriveActionTiles
status: stable
groma:
  id: driveactiontiles
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/DriveActionTiles.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/DriveActionTiles.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/DriveAppDataSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/DriveAppDataSection.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/DriveFileList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/DriveFileList.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/DriveMirrorStatus.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/DriveMirrorStatus.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/DriveQuotaMeter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/DriveQuotaMeter.tsx
      symbol: DriveQuotaMeter
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/ImportFlowDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/ImportFlowDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/drive/BackupChooser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/BackupChooser.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/use-drive-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/drive-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/format.ts
      symbol: formatBytes
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/import-flow.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/upload-client.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/drive/import-controller.ts
description: Shows the three fixed Drive tiles for device backup and cloud file import.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/drive/BackupChooser.tsx](../../../../../../apps/electron/src/renderer/pages/drive/BackupChooser.tsx) | [apps/electron/src/renderer/pages/DrivePage.tsx](../../../../../../apps/electron/src/renderer/pages/DrivePage.tsx) | Invokes supplied callback: onUploaded | react |
| [apps/electron/src/renderer/pages/drive/DriveFileList.tsx](../../../../../../apps/electron/src/renderer/pages/drive/DriveFileList.tsx) | [apps/electron/src/renderer/pages/DrivePage.tsx](../../../../../../apps/electron/src/renderer/pages/DrivePage.tsx) | Invokes supplied callbacks: onDeleteFile, onOpenFolder, onPickFiles | react |
| [apps/electron/src/renderer/pages/drive/ImportFlowDialog.tsx](../../../../../../apps/electron/src/renderer/pages/drive/ImportFlowDialog.tsx) | [apps/electron/src/renderer/pages/DrivePage.tsx](../../../../../../apps/electron/src/renderer/pages/DrivePage.tsx) | Invokes supplied callback: onOpenChange | react |
| [apps/electron/src/renderer/pages/drive/upload-client.ts](../../../../../../apps/electron/src/renderer/pages/drive/upload-client.ts) | [apps/electron/src/renderer/pages/DrivePage.tsx](../../../../../../apps/electron/src/renderer/pages/DrivePage.tsx) | Invokes supplied callback: onProgress | typescript |
