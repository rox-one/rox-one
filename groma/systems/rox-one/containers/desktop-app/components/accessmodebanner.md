---
type: C4 Component
title: AccessModeBanner
status: stable
groma:
  id: accessmodebanner
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/access/AccessModeBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/AccessModeBanner.tsx
      symbol: AccessModeBanner
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/access/PendingSendersList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/PendingSendersList.tsx
      symbol: PendingSendersList
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/access/TelegramAccessSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/TelegramAccessSection.tsx
      symbol: TelegramAccessSection
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/access/OwnersListEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/OwnersListEditor.tsx
      symbol: OwnersListEditor
    - scanner: react
      file: apps/electron/src/renderer/components/messaging/access/BindingAllowListPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/BindingAllowListPopover.tsx
      symbol: BindingAllowListPopover
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/access-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/messaging/access/types.ts
description: Warns when a messaging platform runs in public-inbox mode and offers switching to owner control.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/messaging/access/PendingSendersList.tsx](../../../../../../apps/electron/src/renderer/components/messaging/access/PendingSendersList.tsx) | [apps/electron/src/renderer/playground/demos/messaging/AllowListPreview.tsx](../../../../../../apps/electron/src/renderer/playground/demos/messaging/AllowListPreview.tsx) | Invokes supplied callbacks: onAllow, onIgnore | react |
