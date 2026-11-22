---
type: C4 Component
title: Page visuals
status: stable
groma:
  id: page-visuals
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/pages/page-visuals.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/page-visuals.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageFrame.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageFrame.tsx
      symbol: PageFrame
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageView.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageView.tsx
      symbol: PageView
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PagesHome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PagesHome.tsx
      symbol: PagesHome
    - scanner: react
      file: apps/electron/src/renderer/components/pages/DeletePageDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/DeletePageDialog.tsx
      symbol: DeletePageDialog
    - scanner: react
      file: apps/electron/src/renderer/components/pages/SharePageDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/SharePageDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageGrantsDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageGrantsDialog.tsx
      symbol: PageGrantsDialog
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageGrantRequestDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageGrantRequestDialog.tsx
      symbol: PageGrantRequestDialog
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/pages/PageTile.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/PageTile.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/pages/grant-visuals.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/pages/grant-visuals.tsx
description: Provides shared page kind glyphs, badges and freshness indicators for Pages surfaces.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx](../../../../../../apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx) | [apps/electron/src/renderer/pages/connections-overview.tsx](../../../../../../apps/electron/src/renderer/pages/connections-overview.tsx) | Invokes supplied callback: onClose | react |
| [apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx](../../../../../../apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx) | [apps/electron/src/renderer/pages/IntegrationsCatalogPage.tsx](../../../../../../apps/electron/src/renderer/pages/IntegrationsCatalogPage.tsx) | Invokes supplied callback: onClose | react |
