---
type: C4 Component
title: CreateProjectDialog
status: stable
groma:
  id: createprojectdialog
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/projects/CreateProjectDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/projects/CreateProjectDialog.tsx
      symbol: CreateProjectDialog
    - scanner: react
      file: apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/projects/SharedProjectProjection.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/projects/ProjectIcon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/projects/ProjectIcon.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/projects/ProjectAuthorityConnectionPanel.tsx
      symbol: ProjectAuthorityConnectionPanel
description: Prompts for a project name before creating it, avoiding default slug pile-up.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/projects/CreateProjectDialog.tsx](../../../../../../apps/electron/src/renderer/components/projects/CreateProjectDialog.tsx) | [apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx) | Invokes supplied callbacks: onCancel, onSubmit | react |
