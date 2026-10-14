import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeedSource, FeedSourceKind, FeedTab, XConnectionStatus } from '@rox/shared/feed'
import {
  At, CaretRight, GithubLogo, Globe, Hash, Newspaper, Plugs, PlusCircle, Radio, Robot, Rss,
  SlidersHorizontal, Tag, TreeStructure, Users, YoutubeLogo,
} from '@phosphor-icons/react'
import type { PhosphorIcon } from '@/platform/phosphor-glyphs'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { NAV_CHILDREN_CLASS, NAV_ROW_ACTIVE_CLASS, NAV_ROW_CLASS, NAV_ROW_IDLE_CLASS, NavTitle, type Tone } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import { ColorDot } from './FeedParts'
import { sourceHealth, sourceLabel, sourceTone } from './feed-model'

export type FeedView = FeedTab | 'sources'

type IconTone = 'violet' | 'sky' | 'orange' | 'pink' | 'green' | 'muted'

const DOT: Record<Tone, string> = {
  accent: 'bg-accent', success: 'bg-success', danger: 'bg-destructive',
  warning: 'bg-[var(--warning,#d9a13b)]', info: 'bg-info', muted: 'bg-text-muted',
}

const SOURCE_ICONS: Record<FeedSourceKind, PhosphorIcon> = {
  rss: Rss, atom: Rss, youtube: YoutubeLogo, github: GithubLogo,
  x: At, page: Globe, unknown: Globe,
}

const SOURCE_TONES: Record<FeedSourceKind, IconTone> = {
  rss: 'orange', atom: 'orange', youtube: 'pink', github: 'violet',
  x: 'sky', page: 'green', unknown: 'muted',
}

function Count({ count }: { count?: number | null }) {
  return count && count > 0 ? <span className="shrink-0 text-caption numeric text-text-muted">{count}</span> : null
}

function NavIcon({ icon: Icon, tone, dot }: { icon: PhosphorIcon; tone: IconTone; dot?: Tone }) {
  return (
    // Bare 16px glyph (icon-inline) in muted grey: no tinted box (Mark 2026-10-14).
    <span aria-hidden data-tone={tone} className="relative inline-flex shrink-0 text-text-muted">
      <Icon className="icon-inline" />
      {dot ? <span className={cn('absolute -right-0.5 -top-0.5 size-1.5 rounded-full', DOT[dot])} /> : null}
    </span>
  )
}

function FeedNavButton({ label, secondary, icon, tone, count, active, dot, onClick, testId }: {
  label: ReactNode; secondary?: string; icon: PhosphorIcon; tone: IconTone
  count?: number | null; active?: boolean; dot?: Tone; onClick: () => void; testId: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={cn(NAV_ROW_CLASS, secondary && 'h-auto min-h-7 py-1', active ? NAV_ROW_ACTIVE_CLASS : NAV_ROW_IDLE_CLASS)}>
      <NavIcon icon={icon} tone={tone} dot={dot} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {secondary ? <span className="block truncate text-caption font-normal text-text-muted">{secondary}</span> : null}
      </span>
      <Count count={count} />
    </button>
  )
}

function FeedNavGroup({ id, label, icon, tone, count, active, revealKey, initialOpen, children }: {
  id: string; label: string; icon: PhosphorIcon; tone: IconTone; count?: number
  active?: boolean; revealKey?: string | null; initialOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(Boolean(initialOpen || active))
  const ref = useRef<HTMLDetailsElement>(null)
  // Reveal a newly selected descendant, but preserve manual folding across data refreshes.
  useEffect(() => { if (active) setOpen(true) }, [active, revealKey])
  return (
    <details ref={ref} open={open} onToggle={() => setOpen(ref.current?.open ?? false)} data-testid={`feed-group-${id}`} className="group/feed-nav">
      <summary className={cn(NAV_ROW_CLASS, 'cursor-pointer list-none hover:bg-[var(--state-hover)] [&::-webkit-details-marker]:hidden', active ? 'text-foreground' : 'text-text-secondary')}>
        <NavIcon icon={icon} tone={tone} />
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        <Count count={count} />
        <CaretRight aria-hidden className={cn('icon-status shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
      </summary>
      <div className={cn(NAV_CHILDREN_CLASS, 'pt-px')}>{children}</div>
    </details>
  )
}

export function FeedSidebar({ view, sourceFilter, tagFilter, sources, tags, counts, visibleCount, attention, x, teamName, hasTeam, onViewSelect, onSourceSelect, onTagSelect }: {
  view: FeedView; sourceFilter: string | null; tagFilter: string | null
  sources: readonly FeedSource[]; tags: readonly { tag: string; count: number }[]
  counts: Record<FeedTab, number>; visibleCount: number; attention: number
  x: XConnectionStatus; teamName: string; hasTeam: boolean
  onViewSelect: (view: FeedView) => void; onSourceSelect: (id: string) => void
  onTagSelect: (tag: string | null) => void
}) {
  const { t } = useTranslation()
  const xConnected = x.state === 'connected'
  const countFor = (tab: FeedTab) => view === tab ? visibleCount : counts[tab]
  const inNews = view === 'news' || view === 'sources'
  return (
    <div data-feed-sidebar data-focus-zone="sidebar" className="flex flex-col gap-px" onKeyDown={handleSidebarTreeKeyDown}>
      <NavTitle>{t('feed.title')}</NavTitle>
      <FeedNavButton testId="feed-nav-agents" label={t('feed.tab.agents')} icon={Robot} tone="violet" count={countFor('agents')} dot={attention ? 'warning' : undefined} active={view === 'agents'} onClick={() => onViewSelect('agents')} />
      <FeedNavButton testId="feed-nav-team" label={t('feed.tab.team')} icon={Users} tone="sky" count={countFor('team')} active={view === 'team'} onClick={() => onViewSelect('team')} />
      <FeedNavGroup id="news" label={t('feed.tab.news')} icon={Newspaper} tone="orange" count={counts.news} active={inNews} revealKey={`${view}:${sourceFilter ?? ''}`}>
        <FeedNavButton testId="feed-nav-news" label={t('feed.nav.allNews')} icon={Newspaper} tone="orange" count={view === 'news' && !sourceFilter ? visibleCount : counts.news} active={view === 'news' && !sourceFilter} onClick={() => onViewSelect('news')} />
        <FeedNavGroup id="sources" label={t('feed.nav.sources')} icon={Rss} tone="orange" count={sources.length} active={view === 'sources' || view === 'news' && Boolean(sourceFilter)} revealKey={`${view}:${sourceFilter ?? ''}`} initialOpen>
          {sources.map(source => (
            <FeedNavButton key={source.id} testId={`feed-nav-source-${source.id}`} label={<span className="flex min-w-0 items-center gap-1"><ColorDot color={source.color} size={6} /><span className="truncate" title={sourceLabel(source)}>{sourceLabel(source)}</span></span>}
              icon={SOURCE_ICONS[source.kind]} tone={SOURCE_TONES[source.kind]} count={source.itemCount}
              dot={sourceHealth(source) === 'checking' ? 'accent' : source.paused ? 'muted' : sourceTone(source)}
              active={view === 'news' && sourceFilter === source.id} onClick={() => onSourceSelect(source.id)} />
          ))}
          <FeedNavButton testId="feed-nav-sources" label={t(sources.length ? 'feed.nav.manageSources' : 'feed.nav.addFirstSource')} icon={sources.length ? SlidersHorizontal : PlusCircle} tone="green" active={view === 'sources'} onClick={() => onViewSelect('sources')} />
        </FeedNavGroup>
      </FeedNavGroup>
      <FeedNavButton testId="feed-nav-subscriptions" label={t('feed.tab.subscriptions')} icon={Radio} tone="pink" count={countFor('subscriptions')} dot={!xConnected ? 'muted' : undefined} active={view === 'subscriptions'} onClick={() => onViewSelect('subscriptions')} />
      {tags.length > 0 && view !== 'sources' ? (
        <FeedNavGroup id="tags" label={t('feed.nav.tags')} icon={Tag} tone="violet" active={Boolean(tagFilter)} revealKey={tagFilter} initialOpen>
          {tags.slice(0, 8).map(({ tag, count }) => {
            const active = tagFilter?.toLowerCase() === tag.toLowerCase()
            return <FeedNavButton key={tag} testId={`feed-nav-tag-${tag}`} label={`#${tag}`} icon={Hash} tone="violet" count={count} active={active} onClick={() => onTagSelect(active ? null : tag)} />
          })}
        </FeedNavGroup>
      ) : null}
      <FeedNavGroup id="connections" label={t('feed.nav.connections')} icon={Plugs} tone="sky">
        <FeedNavButton testId="feed-conn-x" label="X" secondary={xConnected ? `@${x.username ?? ''}` : t('feed.x.notConnected')} icon={At} tone="muted" dot={xConnected ? 'success' : x.state === 'error' ? 'danger' : 'muted'} onClick={() => onViewSelect('sources')} />
        <FeedNavButton testId="feed-conn-team" label={t('feed.tab.team')} secondary={teamName} icon={TreeStructure} tone="green" dot={hasTeam ? 'warning' : 'muted'} onClick={() => onViewSelect('team')} />
      </FeedNavGroup>
    </div>
  )
}
