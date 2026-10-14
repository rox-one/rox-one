/**
 * Second-sidebar groups for Автоматизации: Шаблоны / По расписанию / По событию
 * / Агентные / Последние запуски, from the live automations list.
 * Шаблоны = top-50 item 34: ready schedule templates that create a disabled
 * automation (the user reviews it before enabling).
 */
import { Bot, CalendarClock, CheckCircle2, Clock, Sparkles, XCircle, Zap } from 'lucide-react'
import type { SidebarGroup } from '@/components/shell/screen-sidebar'
import { getAutomationGroup, type AutomationGroup, type AutomationListItem } from './types'

export interface ScheduleTemplate { id: string; cron: string; nameKey: string; promptKey: string }

export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
  { id: 'morning-brief', cron: '0 9 * * *', nameKey: 'screenSidebar.automations.tpl.morningBrief', promptKey: 'screenSidebar.automations.tpl.morningBriefPrompt' },
  { id: 'weekday-standup', cron: '30 9 * * 1-5', nameKey: 'screenSidebar.automations.tpl.standup', promptKey: 'screenSidebar.automations.tpl.standupPrompt' },
  { id: 'weekly-review', cron: '0 17 * * 5', nameKey: 'screenSidebar.automations.tpl.weeklyReview', promptKey: 'screenSidebar.automations.tpl.weeklyReviewPrompt' },
  { id: 'inbox-sweep', cron: '0 */2 * * *', nameKey: 'screenSidebar.automations.tpl.inboxSweep', promptKey: 'screenSidebar.automations.tpl.inboxSweepPrompt' },
]

const GROUP_META: Record<AutomationGroup, { titleKey: string; icon: typeof Clock }> = {
  scheduled: { titleKey: 'screenSidebar.automations.scheduled', icon: CalendarClock },
  event: { titleKey: 'screenSidebar.automations.event', icon: Zap },
  agent: { titleKey: 'screenSidebar.automations.agent', icon: Bot },
}

export interface AutomationsSidebarInput {
  automations: readonly AutomationListItem[]
  selectedId: string | null
  creatingTemplate: string | null
  t(key: string): string
  relative(at: number): string
  onOpen(id: string): void
  onCreateFromTemplate(template: ScheduleTemplate): void
  onCreate(): void
}

export function buildAutomationsSidebarGroups(input: AutomationsSidebarInput): SidebarGroup[] {
  const { t } = input
  const templates: SidebarGroup = {
    id: 'templates',
    title: t('screenSidebar.automations.templates'),
    initialVisible: 4,
    items: SCHEDULE_TEMPLATES.map((tpl) => ({
      id: `tpl-${tpl.id}`,
      label: t(tpl.nameKey),
      icon: Sparkles,
      secondary: input.creatingTemplate === tpl.id ? '…' : undefined,
      onSelect: () => input.onCreateFromTemplate(tpl),
    })),
  }
  const byGroup: Record<AutomationGroup, AutomationListItem[]> = { scheduled: [], event: [], agent: [] }
  for (const a of input.automations) byGroup[getAutomationGroup(a.event)].push(a)
  const typed = (Object.keys(GROUP_META) as AutomationGroup[]).map((g): SidebarGroup => ({
    id: g,
    title: t(GROUP_META[g].titleKey),
    initialVisible: 8,
    items: byGroup[g]
      .slice()
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
      .map((a) => ({
        id: `auto-${a.id}`,
        label: a.name,
        icon: GROUP_META[g].icon,
        secondary: a.enabled ? undefined : t('screenSidebar.automations.off'),
        active: a.id === input.selectedId,
        onSelect: () => input.onOpen(a.id),
      })),
  }))
  const recent: SidebarGroup = {
    id: 'recent',
    title: t('screenSidebar.automations.recent'),
    initialVisible: 5,
    items: input.automations
      .filter((a) => typeof a.lastExecutedAt === 'number')
      .sort((a, b) => (b.lastExecutedAt ?? 0) - (a.lastExecutedAt ?? 0))
      .slice(0, 10)
      .map((a) => ({
        id: `run-${a.id}`,
        label: a.name,
        icon: a.lastRunOk === false ? XCircle : CheckCircle2,
        secondary: input.relative(a.lastExecutedAt!),
        onSelect: () => input.onOpen(a.id),
      })),
  }
  const groups = [templates, ...typed, recent].filter((g) => g.items.length > 0)
  if (input.automations.length === 0) {
    groups.push({ id: 'empty', items: [], state: { kind: 'empty', label: t('screenSidebar.automations.empty'), action: { id: 'create', label: t('automations.newAutomation'), onSelect: input.onCreate } } })
  }
  return groups
}
