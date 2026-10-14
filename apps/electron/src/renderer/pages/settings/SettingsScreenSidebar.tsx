import * as React from 'react'
import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useScreenSidebar } from '@/components/shell/screen-sidebar'
import { navigate, routes } from '@/lib/navigate'
import type { SettingsSubpage } from '../../../shared/settings-registry'
import { buildSettingsSidebarGroups } from './settings-sidebar'

/** Publishes the Настройки second sidebar for whichever settings page is open. */
export function SettingsScreenSidebar({ subpage }: { subpage: SettingsSubpage | null }) {
  const { t } = useTranslation()
  const config = React.useMemo(() => ({
    screenId: 'settings',
    title: t('screenSidebar.settings.title'),
    primaryAction: { id: 'overview', label: t('screenSidebar.settings.overview'), icon: LayoutGrid, onSelect: () => navigate(routes.view.settings()) },
    groups: buildSettingsSidebarGroups({ active: subpage, t, onOpen: (page) => navigate(routes.view.settings(page ?? undefined)) }),
  }), [subpage, t])
  useScreenSidebar(config)
  return null
}
