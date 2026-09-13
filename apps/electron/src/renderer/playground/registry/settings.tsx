import * as React from 'react'
import PrivacySettingsPage from '@/pages/settings/PrivacySettingsPage'
import AppearanceSettingsPage from '@/pages/settings/AppearanceSettingsPage'
import RuntimeSettingsPage from '@/pages/settings/RuntimeSettingsPage'
import { PlaygroundAppShellProvider } from '../PlaygroundAppShellProvider'
import type { ComponentEntry } from './types'

function SettingsScreen({ children }: { children: React.ReactNode }) {
  return (
    <PlaygroundAppShellProvider>
      <div className="h-full min-h-[520px] overflow-auto bg-background">{children}</div>
    </PlaygroundAppShellProvider>
  )
}

function PrivacyPlayground() {
  return (
    <SettingsScreen>
      <PrivacySettingsPage />
    </SettingsScreen>
  )
}

function AppearancePlayground() {
  return (
    <SettingsScreen>
      <AppearanceSettingsPage />
    </SettingsScreen>
  )
}

function RuntimePlayground() {
  return (
    <SettingsScreen>
      <RuntimeSettingsPage />
    </SettingsScreen>
  )
}

export const settingsComponents: ComponentEntry[] = [
  {
    id: 'settings-privacy',
    name: 'Settings · Privacy',
    category: 'Settings',
    level: 'Screens',
    description: 'Issue 01 purpose toggles, export and deletion status',
    component: PrivacyPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-appearance',
    name: 'Settings · Appearance',
    category: 'Settings',
    level: 'Screens',
    description: 'High contrast, font triad, Zen Shell default OFF',
    component: AppearancePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-runtime-secrets',
    name: 'Settings · Infisical secrets',
    category: 'Settings',
    level: 'Screens',
    description: 'Secret refs with Infisical unavailable row, no native select',
    component: RuntimePlayground,
    props: [],
    layout: 'full',
  },
]
