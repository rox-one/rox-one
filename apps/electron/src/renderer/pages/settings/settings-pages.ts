/**
 * Settings Page Components Registry
 *
 * Maps settings subpage IDs to their React components.
 * TypeScript enforces that all pages defined in settings-registry have a component here.
 *
 * Each page is React.lazy so the settings chunk graph is not pulled into the cold
 * renderer bundle. Callers must render under Suspense (MainContentPanel already does
 * via wrapWithStoplight).
 *
 * To add a new settings page:
 * 1. Add to SETTINGS_PAGES in shared/settings-registry.ts
 * 2. Create the page component (e.g., NewSettingsPage.tsx)
 * 3. Add a lazy() entry to SETTINGS_PAGE_COMPONENTS below
 * 4. Add icon to SETTINGS_ICONS in components/icons/SettingsIcons.tsx
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import type { SettingsSubpage } from '../../../shared/settings-registry'

const AccountSettingsPage = lazy(() => import('./AccountSettingsPage'))
const PrivacySettingsPage = lazy(() => import('./PrivacySettingsPage'))
const RuntimeSettingsPage = lazy(() => import('./RuntimeSettingsPage'))
const ContextSettingsPage = lazy(() => import('./ContextSettingsPage'))
const KnowledgeSettingsPage = lazy(() => import('./KnowledgeSettingsPage'))
const MarketplaceSettingsPage = lazy(() => import('./MarketplaceSettingsPage'))
const ExtensionsSettingsPage = lazy(() => import('./ExtensionsSettingsPage'))
const ImportSettingsPage = lazy(() => import('./ImportSettingsPage'))
const AppSettingsPage = lazy(() => import('./AppSettingsPage'))
const AiSettingsPage = lazy(() => import('./AiSettingsPage'))
const AppearanceSettingsPage = lazy(() => import('./AppearanceSettingsPage'))
const InputSettingsPage = lazy(() => import('./InputSettingsPage'))
const WorkspaceSettingsPage = lazy(() => import('./WorkspaceSettingsPage'))
const AccountsSettingsPage = lazy(() => import('./AccountsSettingsPage'))
const PermissionsSettingsPage = lazy(() => import('./PermissionsSettingsPage'))
const LabelsSettingsPage = lazy(() => import('./LabelsSettingsPage'))
const OrganizationsSettingsPage = lazy(() => import('./OrganizationsSettingsPage'))
const MessagingSettingsPage = lazy(() => import('./MessagingSettingsPage'))
const ServerSettingsPage = lazy(() => import('./ServerSettingsPage'))
const CloudRunsSettingsPage = lazy(() => import('./CloudRunsSettingsPage'))
const SecuritySettingsPage = lazy(() => import('./SecuritySettingsPage'))
const ShortcutsPage = lazy(() => import('./ShortcutsPage'))

/**
 * Map of settings subpage IDs to their page components.
 * TypeScript will error if a page from SETTINGS_PAGES is missing here.
 */
export const SETTINGS_PAGE_COMPONENTS: Record<
  SettingsSubpage,
  LazyExoticComponent<ComponentType>
> = {
  account: AccountSettingsPage,
  privacy: PrivacySettingsPage,
  runtime: RuntimeSettingsPage,
  context: ContextSettingsPage,
  knowledge: KnowledgeSettingsPage,
  marketplace: MarketplaceSettingsPage,
  extensions: ExtensionsSettingsPage,
  import: ImportSettingsPage,
  app: AppSettingsPage,
  ai: AiSettingsPage,
  appearance: AppearanceSettingsPage,
  input: InputSettingsPage,
  workspace: WorkspaceSettingsPage,
  accounts: AccountsSettingsPage,
  permissions: PermissionsSettingsPage,
  labels: LabelsSettingsPage,
  organizations: OrganizationsSettingsPage,
  messaging: MessagingSettingsPage,
  server: ServerSettingsPage,
  security: SecuritySettingsPage,
  cloudRuns: CloudRunsSettingsPage,
  shortcuts: ShortcutsPage,
}

/**
 * Get the component for a settings subpage.
 * Caller must wrap usage in <Suspense> (already done in MainContentPanel).
 */
export function getSettingsPageComponent(subpage: SettingsSubpage): ComponentType {
  return SETTINGS_PAGE_COMPONENTS[subpage]
}
