/**
 * Second-sidebar groups for Навыки (incl. merged Плейбуки):
 * Мои навыки / Плейбуки / Маркетплейс, from the live skills list and the
 * local playbook notebooks store.
 */
import { BookOpen, Notebook, Plus, Sparkles, Store } from 'lucide-react'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'
import type { LoadedSkill } from '../../../shared/types'
import type { PlaybookNotebook } from '@/pages/playbooks/notebook-store'

export interface SkillsSidebarInput {
  skills: readonly LoadedSkill[]
  syncing: boolean
  playbooks: readonly PlaybookNotebook[] | null
  playbooksError: boolean
  selectedSlug: string | null
  t(key: string): string
  onOpenSkill(skill: LoadedSkill): void
  onOpenPlaybooks(): void
  onOpenCatalog(): void
  onOpenMarketplace(): void
}

export function buildSkillsSidebarGroups(input: SkillsSidebarInput): SidebarGroup[] {
  const { t } = input
  const mine: SidebarGroup = {
    id: 'mine',
    title: t('screenSidebar.skills.mine'),
    initialVisible: 10,
    items: input.skills
      .slice()
      .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
      .map((skill) => ({
        id: `skill-${skill.slug}`,
        label: skill.metadata.name,
        icon: Sparkles,
        active: skill.slug === input.selectedSlug,
        onSelect: () => input.onOpenSkill(skill),
      })),
    ...(input.skills.length === 0
      ? { state: input.syncing ? { kind: 'loading' as const } : { kind: 'empty' as const, label: t('screenSidebar.skills.empty'), action: { id: 'catalog', label: t('screenSidebar.skills.browse'), onSelect: input.onOpenCatalog } } }
      : {}),
  }
  const playbooks: SidebarGroup = {
    id: 'playbooks',
    title: t('screenSidebar.skills.playbooks'),
    initialVisible: 6,
    actions: [{ id: 'new-playbook', label: t('screenSidebar.skills.newPlaybook'), icon: Plus, onSelect: input.onOpenPlaybooks }],
    items: (input.playbooks ?? [])
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((nb) => ({ id: `pb-${nb.id}`, label: nb.name, icon: Notebook, onSelect: input.onOpenPlaybooks })),
    ...(input.playbooksError
      ? { state: { kind: 'error' as const, label: t('screenSidebar.skills.playbooksError'), onRetry: input.onOpenPlaybooks } }
      : (input.playbooks ?? []).length === 0
        ? { state: { kind: 'empty' as const, label: t('screenSidebar.skills.playbooksEmpty'), action: { id: 'open', label: t('screenSidebar.skills.newPlaybook'), onSelect: input.onOpenPlaybooks } } }
        : {}),
  }
  const market: SidebarGroup = {
    id: 'market',
    title: t('screenSidebar.skills.market'),
    initialVisible: 2,
    items: [
      { id: 'catalog', label: t('screenSidebar.skills.catalog'), icon: BookOpen, onSelect: input.onOpenCatalog },
      { id: 'marketplace', label: t('screenSidebar.skills.marketplace'), icon: Store, onSelect: input.onOpenMarketplace },
    ],
  }
  return [mine, playbooks, market]
}
