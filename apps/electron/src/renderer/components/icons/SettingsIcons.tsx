/**
 * Settings Icons
 *
 * Shared Phosphor (regular) icon mapping for settings pages. Used by both:
 * - AppMenu (logo dropdown settings submenu)
 * - SettingsNavigator (settings sidebar panel)
 */

import {
  BookOpen, Buildings, ChatCircle, Cloud, CloudArrowDown, Code, FileText, Gear, Keyboard,
  Notebook, Palette, PuzzlePiece, HardDrives, ShieldWarning, ShieldCheck, Shield, ShoppingBag,
  Sparkle, Tag, ToggleRight, UserCircle, Users,
} from '@phosphor-icons/react'
import type { SettingsSubpage } from '../../../shared/types'

type IconProps = { className?: string }

export const AppSettingsIcon = ({ className }: IconProps) => <ToggleRight className={className} />
export const AiSettingsIcon = ({ className }: IconProps) => <Sparkle className={className} />
export const CloudRunsIcon = ({ className }: IconProps) => <Cloud className={className} />
export const AppearanceIcon = ({ className }: IconProps) => <Palette className={className} />
export const InputIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const WorkspaceIcon = ({ className }: IconProps) => <Buildings className={className} />
export const AccountIcon = ({ className }: IconProps) => <UserCircle className={className} />
export const ExtensionsIcon = ({ className }: IconProps) => <PuzzlePiece className={className} />
export const AccountsIcon = ({ className }: IconProps) => <Users className={className} />
export const PermissionsIcon = ({ className }: IconProps) => <ShieldCheck className={className} />
export const LabelsIcon = ({ className }: IconProps) => <Tag className={className} />
export const OrganizationsIcon = ({ className }: IconProps) => <Users className={className} />
export const MessagingSettingsIcon = ({ className }: IconProps) => <ChatCircle className={className} />
export const ServerSettingsIcon = ({ className }: IconProps) => <HardDrives className={className} />
export const SecuritySettingsIcon = ({ className }: IconProps) => <ShieldWarning className={className} />
export const PrivacySettingsIcon = ({ className }: IconProps) => <Shield className={className} />
export const ShortcutsIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const DevelopersIcon = ({ className }: IconProps) => <Code className={className} />
export const PlaybooksIcon = ({ className }: IconProps) => <Notebook className={className} />
export const RuntimeIcon = ({ className }: IconProps) => <Gear className={className} />
export const ContextIcon = ({ className }: IconProps) => <FileText className={className} />
export const KnowledgeIcon = ({ className }: IconProps) => <BookOpen className={className} />
export const MarketplaceIcon = ({ className }: IconProps) => <ShoppingBag className={className} />
export const ImportIcon = ({ className }: IconProps) => <CloudArrowDown className={className} />

/**
 * Map of settings subpage IDs to their icon components.
 * Used by both AppMenu and SettingsNavigator for consistent icons.
 */
export const SETTINGS_ICONS: Record<SettingsSubpage, React.ComponentType<IconProps>> = {
  learning: KnowledgeIcon,
  account: AccountIcon,
  privacy: PrivacySettingsIcon,
  runtime: RuntimeIcon,
  context: ContextIcon,
  knowledge: KnowledgeIcon,
  marketplace: MarketplaceIcon,
  extensions: ExtensionsIcon,
  import: ImportIcon,
  app: AppSettingsIcon,
  ai: AiSettingsIcon,
  appearance: AppearanceIcon,
  input: InputIcon,
  workspace: WorkspaceIcon,
  accounts: AccountsIcon,
  permissions: PermissionsIcon,
  labels: LabelsIcon,
  organizations: OrganizationsIcon,
  messaging: MessagingSettingsIcon,
  server: ServerSettingsIcon,
  security: SecuritySettingsIcon,
  cloudRuns: CloudRunsIcon,
  shortcuts: ShortcutsIcon,
  developers: DevelopersIcon,
  playbooks: PlaybooksIcon,
}
