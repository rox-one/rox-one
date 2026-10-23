import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FeedSource, FeedSourceKind, FeedTab, XConnectionStatus } from '@rox/shared/feed'
import {
  AtSign, Bot, Cable, ChevronRight, Github, Globe, Hash, MessagesSquare, Network,
  Newspaper, PlusCircle, Radio, Rss, SlidersHorizontal, Tags, Users, Youtube,
  type LucideIcon,
} from 'lucide-react'
import { handleSidebarTreeKeyDown } from '@/components/app-shell/sidebar-keyboard'
import { NavTitle, type Tone } from '@/components/mode-screen/ModeScreen'
import { cn } from '@/lib/utils'
import { ColorDot } from './FeedParts'
import { sourceHealth, sourceLabel, sourceTone } from './feed-model'

export type FeedView = FeedTab | 'sources'

type IconTone = 'violet' | 'sky' | 'orange' | 'pink' | 'green' | 'muted'

const DOT: Record<Tone, string> = {
  accent: 'bg-accent', success: 'bg-success', danger: 'bg-destructive',
  warning: 'bg-[var(--warning,#d9a13b)]', info: 'bg-info', muted: 'bg-text-muted',
}

export const SOURCE_ICONS: Record<FeedSourceKind, LucideIcon> = {
  rss: Rss, atom: Rss, youtube: Youtube, github: Github,
  x: AtSign, page: Globe, unknown: Globe,
}

const SOURCE_TONES: Record<FeedSourceKind, IconTone> = {
  rss: 'orange', atom: 'orange', youtube: 'pink', github: 'violet',
  x: 'sky', page: 'green', unknown: 'muted',
}

function Count({ count }: { count?: number | null }) {
  return count && count > 0 ? <span className="shrink-0 rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-xs numeric text-text-muted">{count}</span> : null
}

function NavIcon({ icon: Icon, tone, dot }: { icon: LucideIcon; tone: IconTone; dot?: Tone }) {
  return (
    // Bare 16px glyph (icon-inline) in muted grey: no tinted box (Mark 2026-10-14).
    <span aria-hidden data-tone={tone} className="relative inline-flex shrink-0 text-text-muted">
      <Icon className="icon-inline" />
      {dot ? <span className={cn('absolute -right-0.5 -top-0.5 size-1.5 rounded-full', DOT[dot])} /> : null}
    </span>
  )
}

function FeedNavButton({ label, secondary, icon, tone, count, active, dot, onClick, testId }: {
  label: ReactNode; secondary?: string; icon: LucideIcon; tone: IconTone
  count?: number | null; active?: boolean; dot?: Tone; onClick: () => void; testId: string
}) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} data-testid={testId}
      className={cn('flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'bg-[var(--state-selected)] text-foreground' : 'text-text-secondary hover:bg-foreground/[0.05] hover:text-foreground')}>
      <NavIcon icon={icon} tone={tone} dot={dot} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {secondary ? <span className="block break-words text-xs font-normal leading-4 text-text-muted">{secondary}</span> : null}
      </span>
      <Count count={count} />
    </button>
  )
}

function FeedNavGroup({ id, label, icon, tone, count, active, revealKey, initialOpen, children }: {
  id: string; label: string; icon: LucideIcon; tone: IconTone; count?: number
  active?: boolean; revealKey?: string | null; initialOpen?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(Boolean(initialOpen || active))
  const ref = useRef<HTMLDetailsElement>(null)
  // Reveal a newly selected descendant, but preserve manual folding across data refreshes.
  useEffect(() => { if (active) setOpen(true) }, [active, revealKey])
  return (
    <details ref={ref} open={open} onToggle={() => setOpen(ref.current?.open ?? false)} data-testid={`feed-group-${id}`} className="mt-1">
      <summary className={cn('flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium outline-none transition-colors hover:bg-foreground/[0.05] motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden', active ? 'text-foreground' : 'text-text-secondary')}>
        <NavIcon icon={icon} tone={tone} />
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        <Count count={count} />
        <ChevronRight aria-hidden className={cn('size-3 shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
      </summary>
      <div className="ml-5 flex flex-col gap-0.5 border-l border-foreground/10 py-1 pl-2">{children}</div>
    </details>
  )
}

export function FeedSidebar({ view, sourceFilter, tagFilter, sources, tags, counts, visibleCount, attention, x, teamName, hasTeam, messengerChannels = [], channelFilter = null, onViewSelect, onSourceSelect, onTagSelect, onChannelSelect }: {
  view: FeedView; sourceFilter: string | null; tagFilter: string | null
  sources: readonly FeedSource[]; tags: readonly { tag: string; count: number }[]
  counts: Record<FeedTab, number>; visibleCount: number; attention: number
  x: XConnectionStatus; teamName: string; hasTeam: boolean
  /** Followed messenger channels (Лента per-channel filter hook). */
  messengerChannels?: readonly { channelId: string; name: string }[]
  channelFilter?: string | null
  onViewSelect: (view: FeedView) => void; onSourceSelect: (id: string) => void
  onTagSelect: (tag: string | null) => void
  onChannelSelect?: (channelId: string | null) => void
}) {
  const { t } = useTranslation()
  const xConnected = x.state === 'connected'
  const countFor = (tab: FeedTab) => view === tab ? visibleCount : counts[tab]
  const inNews = view === 'news' || view === 'sources'
  return (
    // Rox Engineering chrome; optional glass slot is a spot accent only.
    <div data-feed-sidebar data-glass-slot="panel" data-focus-zone="sidebar" onKeyDown={handleSidebarTreeKeyDown}>
      <NavTitle>{t('feed.title')}</NavTitle>
      <FeedNavButton testId="feed-nav-agents" label={t('feed.tab.agents')} icon={Bot} tone="violet" count={countFor('agents')} dot={attention ? 'warning' : undefined} active={view === 'agents'} onClick={() => onViewSelect('agents')} />
      {messengerChannels.length > 0 ? (
        <FeedNavGroup id="team" label={t('feed.tab.team')} icon={Users} tone="sky" count={counts.team} active={view === 'team'} revealKey={`${view}:${channelFilter ?? ''}`} initialOpen>
          <FeedNavButton testId="feed-nav-team" label={t('feed.nav.allTeam')} icon={Users} tone="sky" count={view === 'team' && !channelFilter ? visibleCount : counts.team} active={view === 'team' && !channelFilter} onClick={() => { onChannelSelect?.(null); onViewSelect('team') }} />
          {messengerChannels.map((ch) => (
            <FeedNavButton
              key={ch.channelId}
              testId={`feed-nav-channel-${ch.channelId}`}
              label={ch.name}
              icon={MessagesSquare}
              tone="sky"
              active={view === 'team' && channelFilter === ch.channelId}
              onClick={() => { onChannelSelect?.(ch.channelId); onViewSelect('team') }}
            />
          ))}
        </FeedNavGroup>
      ) : (
        <FeedNavButton testId="feed-nav-team" label={t('feed.tab.team')} icon={Users} tone="sky" count={countFor('team')} active={view === 'team'} onClick={() => onViewSelect('team')} />
      )}
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
        <FeedNavGroup id="tags" label={t('feed.nav.tags')} icon={Tags} tone="violet" active={Boolean(tagFilter)} revealKey={tagFilter} initialOpen>
          {tags.slice(0, 8).map(({ tag, count }) => {
            const active = tagFilter?.toLowerCase() === tag.toLowerCase()
            return <FeedNavButton key={tag} testId={`feed-nav-tag-${tag}`} label={`#${tag}`} icon={Hash} tone="violet" count={count} active={active} onClick={() => onTagSelect(active ? null : tag)} />
          })}
        </FeedNavGroup>
      ) : null}
      <FeedNavGroup id="connections" label={t('feed.nav.connections')} icon={Cable} tone="sky">
        <FeedNavButton testId="feed-conn-x" label="X" secondary={xConnected ? `@${x.username ?? ''}` : t('feed.x.notConnected')} icon={AtSign} tone="muted" dot={xConnected ? 'success' : x.state === 'error' ? 'danger' : 'muted'} onClick={() => onViewSelect('sources')} />
        <FeedNavButton testId="feed-conn-team" label={t('feed.tab.team')} secondary={teamName} icon={Network} tone="green" dot={hasTeam ? 'warning' : 'muted'} onClick={() => onViewSelect('team')} />
      </FeedNavGroup>
    </div>
  )
}
