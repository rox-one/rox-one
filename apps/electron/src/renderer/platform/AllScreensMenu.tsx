/**
 * «Все экраны» — the overflow pill at the end of the titlebar pill.
 *
 * Contextual sidebar: screens switch only through the pills, so every
 * non-hidden surface (pill-placed or not) plus the enabled experimental
 * screens is listed here, grouped and searchable. Keyboard: type to filter,
 * ↑/↓ move, Enter opens, Esc closes (listbox + aria-activedescendant).
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Search } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useNavigationState } from '@/contexts/NavigationContext'
import { enabledExtraScreenIdsAtom } from '@/atoms/extra-screens'
import { visibleExtraScreens } from '@/pages/extra-screens/registry'
import { resolvePrimaryNav } from '../components/app-shell/primary-nav'
import { buildAllScreensGroups, type AllScreensItem } from './all-screens-model'
import { usePillNav } from './usePillNav'
import { useShellModes } from './useModes'
import { useOpenPillBrowser } from './pill-activate'

export const ALL_SCREENS_TRIGGER_ID = 'all-screens'

export function AllScreensMenu({ collapsed = false, onOpenBrowser }: { collapsed?: boolean; onOpenBrowser?: () => void }) {
  const { t } = useTranslation()
  const navState = useNavigationState()
  const { shellFlags } = useShellModes()
  const nav = usePillNav(shellFlags)
  const enabledExtra = useAtomValue(enabledExtraScreenIdsAtom)
  const openBrowser = useOpenPillBrowser()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const listId = React.useId()

  const groups = React.useMemo(() => open ? buildAllScreensGroups({
    surfaces: resolvePrimaryNav({ shellFlags, placements: nav.placements }),
    extraScreens: visibleExtraScreens(enabledExtra),
    t,
    query,
  }) : [], [open, shellFlags, nav.placements, enabledExtra, t, query])
  const flat = React.useMemo(() => groups.flatMap(group => group.items), [groups])
  React.useEffect(() => { setActiveIndex(0) }, [query, open])

  const isCurrent = React.useCallback((item: AllScreensItem) => {
    if (item.extra) return navState.navigator === 'screen' && navState.screen === item.extra.id
    return item.entry ? item.entry.isActive(navState) : false
  }, [navState])

  const activate = React.useCallback((item: AllScreensItem) => {
    if (item.disabled) return
    setOpen(false)
    setQuery('')
    if (item.extra) { navigate(routes.view.screen(item.extra.id)); return }
    const entry = item.entry
    if (!entry) return
    if (entry.action === 'open-browser') { (onOpenBrowser ?? openBrowser)(); return }
    if (entry.route) navigate(entry.route())
  }, [openBrowser, onOpenBrowser])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (flat.length === 0) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(i => (i + 1) % flat.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(i => (i - 1 + flat.length) % flat.length) }
    else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0) }
    else if (event.key === 'End') { event.preventDefault(); setActiveIndex(flat.length - 1) }
    else if (event.key === 'Enter') { event.preventDefault(); const item = flat[activeIndex]; if (item) activate(item) }
  }

  const label = t('workbench.pill.allScreens')
  let index = -1
  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery('') }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              tabIndex={-1}
              data-mode={ALL_SCREENS_TRIGGER_ID}
              data-tour="guide.sidebar-tools"
              data-all-screens-trigger=""
              aria-label={label}
              aria-haspopup="dialog"
              className="rox-mode-pill-item titlebar-no-drag"
            >
              <LayoutGrid className="rox-mode-pill-icon" aria-hidden />
              {!collapsed && <span className="sr-only">{label}</span>}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="center" className="w-[360px] p-0" data-testid="all-screens-menu" aria-label={label}>
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <Search className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('workbench.pill.allScreensSearch')}
            aria-label={t('workbench.pill.allScreensSearch')}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={flat[activeIndex] ? `${listId}-${flat[activeIndex]!.id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div id={listId} role="listbox" aria-label={label} className="max-h-[min(60vh,480px)] overflow-y-auto p-1.5">
          {flat.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('workbench.pill.allScreensEmpty')}</div>}
          {groups.map(group => (
            <div key={group.id} role="group" aria-label={t(group.labelKey)} className="mb-1 last:mb-0">
              <div className="px-2 pb-1 pt-1.5 text-caption font-semibold uppercase caps-label text-text-muted" aria-hidden>{t(group.labelKey)}</div>
              <div className="grid grid-cols-2 gap-0.5">
                {group.items.map(item => {
                  index += 1
                  const myIndex = index
                  const Icon = item.icon
                  const current = isCurrent(item)
                  return (
                    <div
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      role="option"
                      aria-selected={myIndex === activeIndex}
                      aria-disabled={item.disabled || undefined}
                      aria-current={current ? 'page' : undefined}
                      data-screen-id={item.id}
                      onMouseEnter={() => setActiveIndex(myIndex)}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => activate(item)}
                      className={cn(
                        'flex h-8 cursor-default items-center gap-2 rounded-[var(--radius-control)] px-2 text-body text-text-secondary',
                        myIndex === activeIndex && 'bg-[var(--state-hover)] text-foreground',
                        current && 'font-medium text-foreground',
                        item.disabled && 'opacity-50',
                      )}
                    >
                      <Icon className="icon-caption shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.inPills && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" title={t('settings.navPlacement.pills')} aria-hidden />}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
