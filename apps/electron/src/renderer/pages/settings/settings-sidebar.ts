/**
 * Second-sidebar groups for Настройки (incl. merged Разработчикам):
 * Аккаунт / Приложение / ИИ и агенты / Данные / Разработчикам. Every row is a
 * real settings subpage from the registry; the active one is highlighted.
 */
import {
  AppWindow, Bot, Brain, Building2, Cloud, Code2, Database, Download, GraduationCap, Keyboard, KeyRound, Lock,
  MessageSquare, Paintbrush, Puzzle, Server, ShieldCheck, Store, Tag, User, Users, Workflow, type LucideIcon,
} from 'lucide-react'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'
import { SETTINGS_PAGES, type SettingsSubpage } from '../../../shared/settings-registry'

export const SETTINGS_SIDEBAR_GROUPS: ReadonlyArray<{ id: string; titleKey: string; pages: ReadonlyArray<{ id: SettingsSubpage; icon: LucideIcon }> }> = [
  { id: 'account', titleKey: 'screenSidebar.settings.account', pages: [
    { id: 'account', icon: User }, { id: 'accounts', icon: KeyRound }, { id: 'organizations', icon: Building2 },
    { id: 'privacy', icon: Lock }, { id: 'security', icon: ShieldCheck }, { id: 'permissions', icon: Users },
  ] },
  { id: 'app', titleKey: 'screenSidebar.settings.app', pages: [
    { id: 'app', icon: AppWindow }, { id: 'appearance', icon: Paintbrush }, { id: 'input', icon: Keyboard },
    { id: 'shortcuts', icon: Keyboard }, { id: 'workspace', icon: Workflow }, { id: 'labels', icon: Tag },
    { id: 'messaging', icon: MessageSquare }, { id: 'learning', icon: GraduationCap },
  ] },
  { id: 'ai', titleKey: 'screenSidebar.settings.ai', pages: [
    { id: 'ai', icon: Bot }, { id: 'runtime', icon: Server }, { id: 'context', icon: Brain },
    { id: 'playbooks', icon: Workflow }, { id: 'marketplace', icon: Store }, { id: 'extensions', icon: Puzzle },
  ] },
  { id: 'data', titleKey: 'screenSidebar.settings.data', pages: [
    { id: 'knowledge', icon: Database }, { id: 'import', icon: Download }, { id: 'cloudRuns', icon: Cloud },
  ] },
  { id: 'developers', titleKey: 'screenSidebar.settings.developers', pages: [
    { id: 'developers', icon: Code2 }, { id: 'server', icon: Server },
  ] },
]

export function buildSettingsSidebarGroups(input: {
  active: SettingsSubpage | null
  t(key: string): string
  onOpen(page: SettingsSubpage | null): void
}): SidebarGroup[] {
  const known = new Map(SETTINGS_PAGES.map((p) => [p.id, p.labelKey]))
  return SETTINGS_SIDEBAR_GROUPS.map((group) => ({
    id: group.id,
    title: input.t(group.titleKey),
    initialVisible: group.pages.length,
    items: group.pages.filter((p) => known.has(p.id)).map((p) => ({
      id: p.id,
      label: input.t(known.get(p.id)!),
      icon: p.icon,
      active: input.active === p.id,
      onSelect: () => input.onOpen(p.id),
    })),
  }))
}
