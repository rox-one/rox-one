import * as React from 'react'
import { RefreshCw, Settings, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useScreenSidebar, type ScreenSidebarConfig } from '@/components/shell/screen-sidebar'
import type { ClipboardHistoryController } from './use-clipboard-history'
import { buildClipboardSidebarGroups } from './clipboard-sidebar'

/** Publishes the Буфер обмена second sidebar, bound to the live controller. */
export function useClipboardSidebar(
  h: ClipboardHistoryController,
  actions: { openSettings(): void; openClear(): void },
): void {
  const { t } = useTranslation()
  const { setSelectedId, dispatch, refresh } = h
  const { openSettings, openClear } = actions
  const config = React.useMemo<ScreenSidebarConfig>(() => ({
    screenId: 'clipboard',
    title: t('clipboard.title'),
    search: {
      placeholder: t('clipboard.search.placeholder'),
      value: h.filters.query,
      onChange: (query: string) => dispatch({ type: 'query', query }),
    },
    headerActions: [
      { id: 'refresh', label: t('screenSidebar.clipboard.refresh'), icon: RefreshCw, onSelect: refresh },
      { id: 'settings', label: t('clipboard.action.settings'), icon: Settings, onSelect: openSettings },
      { id: 'clear', label: t('clipboard.action.clearAll'), icon: Trash2, destructive: true, onSelect: openClear },
    ],
    groups: buildClipboardSidebarGroups({
      entries: h.entries,
      counts: h.counts,
      now: h.now,
      selectedId: h.selectedId,
      activeKind: h.filters.kind,
      loading: h.loading,
      error: h.error,
      labels: {
        pinned: t('screenSidebar.clipboard.pinned'),
        today: t('screenSidebar.clipboard.today'),
        earlier: t('screenSidebar.clipboard.earlier'),
        types: t('screenSidebar.clipboard.types'),
        image: t('screenSidebar.clipboard.image'),
        text: t('screenSidebar.clipboard.text'),
        images: t('screenSidebar.clipboard.images'),
        empty: t('screenSidebar.clipboard.empty'),
        error: t('screenSidebar.clipboard.error'),
      },
      onOpenEntry: setSelectedId,
      onFilterKind: (kind) => dispatch({ type: 'kind', kind }),
      onRetry: refresh,
    }),
  }), [h.entries, h.counts, h.now, h.selectedId, h.filters.kind, h.filters.query, h.loading, h.error, t, setSelectedId, dispatch, refresh, openSettings, openClear])
  useScreenSidebar(config)
}
