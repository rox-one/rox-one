---
type: C4 Component
title: MobileMenuPage
status: stable
groma:
  id: mobilemenupage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-menu/MobileMenuPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/MobileMenuPage.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-menu/DesktopAppMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/DesktopAppMenu.tsx
      symbol: DesktopAppMenu
    - scanner: react
      file: apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx
      symbol: MobileAppMenu
    - scanner: react
      file: apps/electron/src/renderer/components/app-menu/MobileMenuItem.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/MobileMenuItem.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/mobile-menu-pages.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/menu-icons.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-menu/types.ts
      symbol: AppMenuProps
description: Provides the full-screen mobile menu page shell with back, title, close and safe-area padding.
---
