---
type: C4 Component
title: KeeperItemsPane
status: stable
groma:
  id: keeperitemspane
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemsPane.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemsPane.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/SecretsPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/SecretsPage.tsx
      symbol: SecretsPage
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultPanel.tsx
      symbol: VaultPanel
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDetail.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/VaultItemDetail.tsx
      symbol: VaultItemDetail
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/KeeperItemEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/secrets/TotpCountdown.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/TotpCountdown.tsx
      symbol: TotpCountdown
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/keeper-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/secrets/vault-model.ts
description: Browses and edits ROX Keeper vault spaces, items and secrets through the typed vault bridge.
---
