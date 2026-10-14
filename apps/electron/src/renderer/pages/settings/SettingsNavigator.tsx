/**
 * SettingsNavigator
 *
 * Navigator panel content for settings. Displays grouped, searchable settings
 * sections that can be selected to show in the details panel.
 *
 * Styling follows SessionList/SourcesListPanel patterns for visual consistency.
 */

import { useState, useMemo, useRef, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreHorizontal, AppWindow, Search, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import { DropdownMenuProvider } from '@/components/ui/menu-context'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SettingsSubpage } from '../../../shared/types'
import { SETTINGS_ITEMS } from '../../../shared/menu-schema'
import { filterSettingsPages, groupSettingsPages } from '../../../shared/settings-presentation'
import { SETTINGS_ICONS } from '@/components/icons/SettingsIcons'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'navigator',
}

interface SettingsNavigatorProps {
  /**
   * Currently selected settings subpage. `null` means the bare `settings`
   * route (no row highlighted) — happens in compact mode where the navigator
   * stands alone before the user drills into a subpage.
   */
  selectedSubpage: SettingsSubpage | null
  /** Called when a subpage is selected */
  onSelectSubpage: (subpage: SettingsSubpage) => void
}

interface SettingsItem {
  id: SettingsSubpage
  label: string
  icon: ComponentType<{ className?: string }>
  description: string
}

interface SettingsItemRowProps {
  item: SettingsItem
  isSelected: boolean
  onSelect: () => void
}

/**
 * SettingsItemRow - Individual settings item with dropdown menu
 * Tracks menu open state to keep "..." button visible when menu is open
 */
function SettingsItemRow({ item, isSelected, onSelect }: SettingsItemRowProps) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const Icon = item.icon
  const descriptionId = `settings-nav-desc-${item.id}`

  // Open settings page in a new window via deep link
  const handleOpenInNewWindow = () => {
    window.electronAPI.openUrl(`rox://settings/${item.id}?window=focused`)
  }

  return (
    <div className="settings-item [contain:layout_paint]" data-selected={isSelected || undefined}>
      {/* Compact Cursor-like row: 16px muted glyph + 13px label on one 28px line; the
          description is a focus/hover tooltip and the row's accessible description. */}
      <div className="settings-content relative group select-none px-2">
        <span id={descriptionId} className="sr-only">{item.description}</span>
        <Tooltip>
        <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          aria-describedby={descriptionId}
          className={cn(
            'flex h-7 w-full items-center gap-2 rounded-md px-2 pr-8 text-left text-body outline-none',
            'transition-[background-color] duration-75 focus-visible:ring-1 focus-visible:ring-ring',
            isSelected
              ? 'bg-[var(--state-selected)] text-foreground'
              : 'text-text-secondary hover:bg-[var(--state-hover)] hover:text-foreground'
          )}
        >
          <Icon className={cn('icon-inline', isSelected ? 'text-foreground' : 'text-text-muted')} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
        </button>
        </TooltipTrigger>
        <TooltipContent side="right">{item.description}</TooltipContent>
        </Tooltip>
        {/* Action buttons - visible on hover or when menu is open */}
        <div
          data-touch-reveal="true"
          className={cn(
            'absolute right-3 top-1/2 -translate-y-1/2 transition-opacity z-10',
            menuOpen
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
          )}
        >
          <div className="flex items-center rounded-[var(--radius-control)] overflow-hidden border border-transparent hover:border-border/50">
            <DropdownMenu modal={true} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('sessionMenu.openInNewWindow')}
                  className="p-1 hover:bg-[var(--state-hover)] data-[state=open]:bg-[var(--state-hover)] cursor-pointer"
                >
                  <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <StyledDropdownMenuContent align="end">
                <DropdownMenuProvider>
                  <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
                    <AppWindow className="h-3.5 w-3.5" />
                    <span className="flex-1">{t("sessionMenu.openInNewWindow")}</span>
                  </StyledDropdownMenuItem>
                </DropdownMenuProvider>
              </StyledDropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SettingsNavigator({
  selectedSubpage,
  onSelectSubpage,
}: SettingsNavigatorProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const settingsItems: SettingsItem[] = useMemo(() =>
    SETTINGS_ITEMS.map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      icon: SETTINGS_ICONS[item.id],
      description: t(item.descriptionKey),
    })),
    [t]
  )

  const groupedSettingsItems = useMemo(
    () => groupSettingsPages(filterSettingsPages(settingsItems, query)),
    [query, settingsItems],
  )

  const handleClearSearch = () => {
    setQuery('')
    searchInputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.navigator.search')}
            aria-label={t('settings.navigator.search')}
            data-testid="settings-navigator-search"
            className="h-[var(--control-lg)] pl-9 pr-9"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={handleClearSearch}
              data-testid="settings-navigator-clear"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[var(--radius-control)] text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={t('settings.navigator.clearSearch')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {groupedSettingsItems.length > 0 ? (
          <div className="pb-6">
            {groupedSettingsItems.map(({ group, pages }) => (
              <section key={group.id} className="flex flex-col gap-px pt-3 first:pt-1">
                <h2 className="px-4 pb-1 text-caption font-medium text-text-muted">
                  {t(group.labelKey)}
                </h2>
                {pages.map((item, index) => (
                  <SettingsItemRow
                    key={item.id}
                    item={item}
                    isSelected={selectedSubpage === item.id}
                    onSelect={() => onSelectSubpage(item.id)}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div
            className="px-5 py-10 text-center text-sm text-muted-foreground"
            role="status"
            data-testid="settings-navigator-empty"
          >
            {t('settings.navigator.noResults', { query })}
          </div>
        )}
      </div>
    </div>
  )
}
