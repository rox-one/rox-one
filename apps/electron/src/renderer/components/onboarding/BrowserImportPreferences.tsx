import { useTranslation } from 'react-i18next'
import { Bookmark, Cookie, History, KeyRound, Puzzle } from 'lucide-react'
import {
  BROWSER_IMPORT_CATEGORIES,
  type BrowserImportCategory,
} from '@craft-agent/shared/environment'
import { cn } from '@/lib/utils'

const CATEGORY_ROWS = {
  bookmarks: { key: 'onboarding.environment.browserImportBookmarks', icon: Bookmark, color: 'text-violet-500' },
  history: { key: 'onboarding.environment.browserImportHistory', icon: History, color: 'text-sky-500' },
  cookies: { key: 'onboarding.environment.browserImportCookies', icon: Cookie, color: 'text-amber-500' },
  credentials: { key: 'onboarding.environment.browserImportCredentials', icon: KeyRound, color: 'text-emerald-500' },
  extensions: { key: 'onboarding.environment.browserImportExtensions', icon: Puzzle, color: 'text-pink-500' },
} as const

/** Selection preferences only. Native per-profile access is requested by Import settings. */
export function BrowserImportPreferences({
  selected,
  onChange,
  disabled = false,
}: {
  selected: BrowserImportCategory[] | null
  onChange: (categories: BrowserImportCategory[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <fieldset disabled={disabled} className="grid gap-2 sm:grid-cols-2">
      <legend className="sr-only">{t('onboarding.environment.browserImport')}</legend>
      {BROWSER_IMPORT_CATEGORIES.map((category) => {
        const { key, icon: Icon, color } = CATEGORY_ROWS[category]
        const checked = selected?.includes(category) ?? false
        return (
          <label key={category} className={cn('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors motion-reduce:transition-none',
            checked ? 'border-accent/25 bg-accent/5' : 'border-border/60 bg-background/30 hover:bg-foreground/5')}>
            <input type="checkbox" checked={checked} className="accent-accent" data-browser-import-category={category}
              onChange={() => {
                const next = selected ?? []
                onChange(checked ? next.filter((item) => item !== category) : [...next, category])
              }} />
            <Icon className={cn('size-4 shrink-0', color)} aria-hidden="true" />
            <span>{t(key)}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
