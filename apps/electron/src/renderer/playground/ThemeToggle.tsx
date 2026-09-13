import { Moon, Sun, Monitor, Contrast } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/context/ThemeContext'
import { cn } from '@/lib/utils'

type ThemeMode = 'light' | 'dark' | 'system'

export function ThemeToggle() {
  const { t } = useTranslation()
  const { mode, setMode, contrast, setContrast } = useTheme()

  const modes: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
    { mode: 'light', icon: Sun, label: t('settings.appearance.light') },
    { mode: 'dark', icon: Moon, label: t('settings.appearance.dark') },
    { mode: 'system', icon: Monitor, label: t('settings.appearance.system') },
  ]

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 p-1 rounded-lg bg-foreground/5">
        {modes.map(({ mode: m, icon: Icon, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
              mode === m
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={label}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        data-testid="playground-high-contrast"
        aria-pressed={contrast === 'high'}
        onClick={() => setContrast(contrast === 'high' ? 'normal' : 'high')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          contrast === 'high'
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
            : 'bg-foreground/5 text-muted-foreground hover:text-foreground',
        )}
        title={t('settings.appearance.contrastHigh')}
      >
        <Contrast className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('settings.appearance.contrastHigh')}</span>
      </button>
    </div>
  )
}
