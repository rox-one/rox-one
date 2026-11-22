---
type: C4 Component
title: SearchableModelInput
status: stable
groma:
  id: searchablemodelinput
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SearchableModelInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SearchableModelInput.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsLoadingSkeleton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsLoadingSkeleton.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/OpenClawAuditSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/OpenClawAuditSection.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsSelect.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsSelect.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsToggle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsToggle.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsFieldContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsFieldContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsRadioGroup.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsRadioGroup.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsRow.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsSection.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsEditRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsEditRow.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsInput.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/CommandGatewaySection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/CommandGatewaySection.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/settings/SettingsTextarea.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsTextarea.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/SettingsUIConstants.ts
      symbol: settingsUI
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/settings-menu-navigation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/settings/index.ts
description: Provides a text input with a searchable model dropdown for custom model configuration.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/settings/SettingsInput.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsInput.tsx) | [apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/settings/SettingsInput.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsInput.tsx) | [apps/electron/src/renderer/pages/settings/PreferencesPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/PreferencesPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/settings/SettingsInput.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsInput.tsx) | [apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx) | [apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx) | [apps/electron/src/renderer/pages/settings/SuperEngineeringAppearanceSettings.tsx](../../../../../../apps/electron/src/renderer/pages/settings/SuperEngineeringAppearanceSettings.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx) | [apps/electron/src/renderer/pages/settings/ZenShellSettings.tsx](../../../../../../apps/electron/src/renderer/pages/settings/ZenShellSettings.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx) | [apps/electron/src/renderer/lib/lite-mode.ts](../../../../../../apps/electron/src/renderer/lib/lite-mode.ts) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx) | [apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx) | [apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx) | [apps/electron/src/renderer/pages/settings/ThemeLayersSection.tsx](../../../../../../apps/electron/src/renderer/pages/settings/ThemeLayersSection.tsx) | Invokes supplied callback: onValueChange | react |
| [apps/electron/src/renderer/components/settings/SettingsTextarea.tsx](../../../../../../apps/electron/src/renderer/components/settings/SettingsTextarea.tsx) | [apps/electron/src/renderer/pages/settings/PreferencesPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/PreferencesPage.tsx) | Invokes supplied callback: onChange | react |
