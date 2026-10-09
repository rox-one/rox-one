/**
 * Лента sections (W3.1, D4). The merged Feed screen has two sections —
 * «Поток» (the aggregator) and «Входящие» (the triage queue) — on one
 * segmented strip built from the shared tab primitive (`components/ui/tabs`),
 * following the `EntityViewTabs` `segmented` convention. Selecting a section
 * navigates to that section's route, so `routes.view.feed()` and
 * `routes.view.inbox()` stay the deep link into either half.
 *
 * «Уведомления» has no section: in-app notifications are already folded into
 * the inbox capability (`notifications.in-app.v1`), i.e. they surface in the
 * «Входящие» queue.
 */
import { useTranslation } from 'react-i18next'
import { Inbox, Rss } from 'lucide-react'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { navigate, routes } from '@/lib/navigate'

export type FeedSection = 'stream' | 'inbox'

export function FeedSectionTabs({ section }: { section: FeedSection }) {
  const { t } = useTranslation()
  const items: TabItem[] = [
    {
      id: 'stream',
      label: t('feed.section.stream'),
      title: t('feed.section.stream'),
      icon: <Rss className="icon-caption shrink-0" aria-hidden />,
    },
    {
      id: 'inbox',
      label: t('feed.section.inbox'),
      title: t('feed.section.inbox'),
      icon: <Inbox className="icon-caption shrink-0" aria-hidden />,
    },
  ]
  return (
    <div
      className="flex shrink-0 items-center border-b border-border/40 bg-background/40 px-3 py-1.5"
      data-testid="feed-section-tabs"
    >
      <Tabs
        items={items}
        activeId={section}
        variant="segmented"
        density="compact"
        keyboard
        tone="accent"
        ariaLabel={t('feed.section.label')}
        onSelect={(id) => navigate(id === 'inbox' ? routes.view.inbox() : routes.view.feed())}
      />
    </div>
  )
}