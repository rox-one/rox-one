import * as React from 'react'
import PrivacySettingsPage from '@/pages/settings/PrivacySettingsPage'
import AppearanceSettingsPage from '@/pages/settings/AppearanceSettingsPage'
import RuntimeSettingsPage from '@/pages/settings/RuntimeSettingsPage'
import CloudRunsSettingsPage from '@/pages/settings/CloudRunsSettingsPage'
import SecuritySettingsPage from '@/pages/settings/SecuritySettingsPage'
import MarketplaceSettingsPage from '@/pages/settings/MarketplaceSettingsPage'
import ImportSettingsPage from '@/pages/settings/ImportSettingsPage'
import { QuestProgressCard } from '@/components/app-shell/QuestProgressCard'
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

function CloudRunsPlayground() {
  return (
    <SettingsScreen>
      <CloudRunsSettingsPage />
    </SettingsScreen>
  )
}

function SecurityPlayground() {
  return (
    <SettingsScreen>
      <SecuritySettingsPage />
    </SettingsScreen>
  )
}

function MarketplacePlayground() {
  return (
    <SettingsScreen>
      <MarketplaceSettingsPage />
    </SettingsScreen>
  )
}

function ImportPlayground() {
  return (
    <SettingsScreen>
      <ImportSettingsPage />
    </SettingsScreen>
  )
}

function QuestEmptyPlayground() {
  const [ready, setReady] = React.useState(false)
  React.useLayoutEffect(() => {
    const api = window.electronAPI
    const previous = api.getGamificationProfile
    api.getGamificationProfile = async () => {
      const profile = await previous()
      return { ...profile, quests: [] }
    }
    setReady(true)
    return () => {
      api.getGamificationProfile = previous
    }
  }, [])
  if (!ready) return null
  return (
    <PlaygroundAppShellProvider>
      <div className="mx-auto w-full max-w-md bg-background p-4">
        <QuestProgressCard />
      </div>
    </PlaygroundAppShellProvider>
  )
}

function QuestActivePlayground() {
  return (
    <PlaygroundAppShellProvider>
      <div className="mx-auto w-full max-w-md bg-background p-4">
        <QuestProgressCard />
      </div>
    </PlaygroundAppShellProvider>
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
  {
    id: 'settings-cloud-runs',
    name: 'Settings · Cloud Runs',
    category: 'Settings',
    level: 'Screens',
    description: 'PanelHeader chrome, i18n placeholders, Rox sandbox empty gate',
    component: CloudRunsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-security',
    name: 'Settings · Security',
    category: 'Settings',
    level: 'Screens',
    description: 'Audit empty findings, HOST_ONLY, Infisical health',
    component: SecurityPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-marketplace',
    name: 'Settings · Marketplace',
    category: 'Settings',
    level: 'Screens',
    description: 'PremiumMenu sort/tag filters and compact stats',
    component: MarketplacePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-import',
    name: 'Settings · Import',
    category: 'Settings',
    level: 'Screens',
    description: 'PremiumMenu kind filter and scan/persist chrome',
    component: ImportPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'home-quests-active',
    name: 'Home · Quest slider',
    category: 'Settings',
    level: 'Screens',
    description: 'Home quest strip with available quests',
    component: QuestActivePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'home-quests-empty',
    name: 'Home · Quests empty',
    category: 'Settings',
    level: 'Screens',
    description: 'Caught-up empty state when no visible quests remain',
    component: QuestEmptyPlayground,
    props: [],
    layout: 'full',
  },
]
