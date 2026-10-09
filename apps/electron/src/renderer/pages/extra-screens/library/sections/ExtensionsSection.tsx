import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExtensionsSettingsPage from '@/pages/settings/ExtensionsSettingsPage'
import MarketplaceSettingsPage from '@/pages/settings/MarketplaceSettingsPage'
import { cn } from '@/lib/utils'

type ExtensionTab = 'marketplace' | 'extensions'

/** «Расширения и маркетплейс» — one section, two existing settings surfaces. */
export default function ExtensionsSection() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ExtensionTab>('marketplace')
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="library-extensions">
      <div className="flex shrink-0 gap-1 pb-2">
        {(['marketplace', 'extensions'] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'rounded-[var(--radius-control)] px-2.5 py-1 text-small',
              tab === id ? 'bg-surface-pressed text-foreground' : 'text-muted-foreground hover:bg-surface-hover',
            )}
          >
            {t(`workbench.library.tab.${id}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'marketplace' ? <MarketplaceSettingsPage /> : <ExtensionsSettingsPage />}</div>
    </div>
  )
}