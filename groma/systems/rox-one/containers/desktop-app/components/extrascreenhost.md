---
type: C4 Component
title: ExtraScreenHost
status: stable
groma:
  id: extrascreenhost
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreenHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreenHost.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreenItemUnavailable.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreenItemUnavailable.tsx
      symbol: ExtraScreenItemUnavailable
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/ui.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/ui.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreensRailGroup.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/ExtraScreensRailGroup.tsx
      symbol: ExtraScreensRailGroup
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/registry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/background.ts
description: Mounts one optional extra workbench screen by id, showing an honest off state when disabled.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/agents/AgentCenterPage.tsx) | Invokes supplied callback: onEnter | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/decisions/DecisionsPage.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/decisions/DecisionsPage.tsx) | Invokes supplied callbacks: onChange, onEnter | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/dossier/DossierPage.tsx) | Invokes supplied callbacks: onChange, onEnter | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/library/LibraryPage.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/library/LibraryPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/radar/RadarPage.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/radar/RadarPage.tsx) | Invokes supplied callback: onEnter | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemEditor.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemEditor.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDialog.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDialog.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/pages/extra-screens/ui.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/ui.tsx) | [apps/electron/src/renderer/pages/extra-screens/secrets/VaultPanel.tsx](../../../../../../apps/electron/src/renderer/pages/extra-screens/secrets/VaultPanel.tsx) | Invokes supplied callback: onChange | react |
