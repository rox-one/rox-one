import * as React from 'react'
import PrivacySettingsPage from '@/pages/settings/PrivacySettingsPage'
import AccountSettingsPage from '@/pages/settings/AccountSettingsPage'
import AppearanceSettingsPage from '@/pages/settings/AppearanceSettingsPage'
import RuntimeSettingsPage from '@/pages/settings/RuntimeSettingsPage'
import CloudRunsSettingsPage from '@/pages/settings/CloudRunsSettingsPage'
import SecuritySettingsPage from '@/pages/settings/SecuritySettingsPage'
import MarketplaceSettingsPage from '@/pages/settings/MarketplaceSettingsPage'
import ContextSettingsPage from '@/pages/settings/ContextSettingsPage'
import KnowledgeSettingsPage from '@/pages/settings/KnowledgeSettingsPage'
import ImportSettingsPage from '@/pages/settings/ImportSettingsPage'
import ExtensionsSettingsPage from '@/pages/settings/ExtensionsSettingsPage'
import AppSettingsPage from '@/pages/settings/AppSettingsPage'
import AiSettingsPage from '@/pages/settings/AiSettingsPage'
import InputSettingsPage from '@/pages/settings/InputSettingsPage'
import WorkspaceSettingsPage from '@/pages/settings/WorkspaceSettingsPage'
import AccountsSettingsPage from '@/pages/settings/AccountsSettingsPage'
import PermissionsSettingsPage from '@/pages/settings/PermissionsSettingsPage'
import LabelsSettingsPage from '@/pages/settings/LabelsSettingsPage'
import OrganizationsSettingsPage from '@/pages/settings/OrganizationsSettingsPage'
import MessagingSettingsPage from '@/pages/settings/MessagingSettingsPage'
import ServerSettingsPage from '@/pages/settings/ServerSettingsPage'
import ShortcutsPage from '@/pages/settings/ShortcutsPage'
import { ActionRegistryProvider } from '@/actions/registry'
import { QuestProgressCard } from '@/components/app-shell/QuestProgressCard'
import { PlaygroundAppShellProvider } from '../PlaygroundAppShellProvider'
import { ModalProvider } from '@/context/ModalContext'
import { NavigationProvider } from '@/contexts/NavigationContext'
import type { ComponentEntry } from './types'

function SettingsScreen({ children }: { children: React.ReactNode }) {
  return (
    <PlaygroundAppShellProvider>
      <ModalProvider>
        <div className="h-full min-h-[520px] overflow-auto bg-background">{children}</div>
      </ModalProvider>
    </PlaygroundAppShellProvider>
  )
}

function AccountPlayground() {
  return (
    <SettingsScreen>
      <AccountSettingsPage />
    </SettingsScreen>
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

function AiPlayground() {
  return (
    <SettingsScreen>
      <AiSettingsPage />
    </SettingsScreen>
  )
}

function InputPlayground() {
  return (
    <SettingsScreen>
      <InputSettingsPage />
    </SettingsScreen>
  )
}

function WorkspacePlayground() {
  return (
    <SettingsScreen>
      <WorkspaceSettingsPage />
    </SettingsScreen>
  )
}

function AccountsPlayground() {
  return (
    <SettingsScreen>
      <AccountsSettingsPage />
    </SettingsScreen>
  )
}

function PermissionsPlayground() {
  return (
    <SettingsScreen>
      <PermissionsSettingsPage />
    </SettingsScreen>
  )
}

function LabelsPlayground() {
  return (
    <SettingsScreen>
      <LabelsSettingsPage />
    </SettingsScreen>
  )
}

function OrganizationsPlayground() {
  return (
    <SettingsScreen>
      <OrganizationsSettingsPage />
    </SettingsScreen>
  )
}

function MessagingPlayground() {
  const onCreateSession = React.useCallback(async () => {
    throw new Error('[Playground] onCreateSession is not available')
  }, [])
  return (
    <SettingsScreen>
      <NavigationProvider
        workspaceId="playground-workspace"
        workspaceSlug="playground"
        onCreateSession={onCreateSession}
        isReady
        isSessionsReady
      >
        <MessagingSettingsPage />
      </NavigationProvider>
    </SettingsScreen>
  )
}

function ServerPlayground() {
  return (
    <SettingsScreen>
      <ServerSettingsPage />
    </SettingsScreen>
  )
}

function ShortcutsPlayground() {
  return (
    <SettingsScreen>
      <ActionRegistryProvider>
        <ShortcutsPage />
      </ActionRegistryProvider>
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

function ExtensionsPlayground() {
  return (
    <SettingsScreen>
      <ExtensionsSettingsPage />
    </SettingsScreen>
  )
}

function AppPlayground() {
  return (
    <SettingsScreen>
      <AppSettingsPage />
    </SettingsScreen>
  )
}

function ContextPlayground() {
  return (
    <SettingsScreen>
      <ContextSettingsPage />
    </SettingsScreen>
  )
}

function KnowledgePlayground() {
  return (
    <SettingsScreen>
      <KnowledgeSettingsPage />
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
    id: 'settings-account',
    name: 'Settings · Account',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-041 native account chrome; plan is not spend',
    component: AccountPlayground,
    props: [],
    layout: 'full',
  },
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
    description: 'ROX2-051 native appearance chrome; prefs are local writes',
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
    description: 'ROX2-061 native cloudRuns chrome; config save is not spend',
    component: CloudRunsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-security',
    name: 'Settings · Security',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-056 native security chrome; install is not spend',
    component: SecurityPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-marketplace',
    name: 'Settings · Marketplace',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-045 native marketplace chrome; install is not spend',
    component: MarketplacePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-context',
    name: 'Settings · Context',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-044 native context docs chrome; no Conation iframe',
    component: ContextPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-knowledge',
    name: 'Settings · Knowledge',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-046 native knowledge chrome; token write is local',
    component: KnowledgePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-extensions',
    name: 'Settings · Extensions',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-047 native extensions chrome; install is not spend',
    component: ExtensionsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-app',
    name: 'Settings · App',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-049 native app chrome; prefs are local writes',
    component: AppPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-import',
    name: 'Settings · Import',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-048 native import chrome; scan is device-read, persist is local',
    component: ImportPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-ai',
    name: 'Settings · AI',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-050 native AI chrome; connection test is not spend',
    component: AiPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-input',
    name: 'Settings · Input',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-052 native input chrome; prefs are local writes',
    component: InputPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-workspace',
    name: 'Settings · Workspace',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-053 native workspace chrome; prefs are local writes',
    component: WorkspacePlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-accounts',
    name: 'Settings · Accounts',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-054 native accounts chrome; connect is not spend',
    component: AccountsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-permissions',
    name: 'Settings · Permissions',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-055 native permissions chrome; config load is device-read',
    component: PermissionsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-labels',
    name: 'Settings · Labels',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-057 native labels chrome; delete is destroy',
    component: LabelsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-organizations',
    name: 'Settings · Organizations',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-058 native orgs chrome; invite is not spend',
    component: OrganizationsPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-messaging',
    name: 'Settings · Messaging',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-059 native messaging chrome; connect is not spend',
    component: MessagingPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-server',
    name: 'Settings · Server',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-060 native server chrome; save is a local write',
    component: ServerPlayground,
    props: [],
    layout: 'full',
  },
  {
    id: 'settings-shortcuts',
    name: 'Settings · Shortcuts',
    category: 'Settings',
    level: 'Screens',
    description: 'ROX2-062 native shortcuts chrome; catalog load is device-read',
    component: ShortcutsPlayground,
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
