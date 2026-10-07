import { useTranslation } from 'react-i18next'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { ScrambleTagline } from '@/components/ui/ScrambleTagline'
import { cn } from '@/lib/utils'

export interface ProjectHubProps {
  className?: string
  onQuickStart?: () => void
  onCloneUrl?: () => void
}

export function ProjectHub({ className, onQuickStart, onCloneUrl }: ProjectHubProps) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 pb-6 text-center',
        className,
      )}
      data-testid="project-hub"
    >
      <CraftAgentsSymbol className="size-24 max-h-[22vh] opacity-85 dark:invert" />
      <h2 className="text-lg font-medium tracking-tight text-foreground/80">{t('se.hub.title')}</h2>
      <ScrambleTagline className="max-w-md" />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {onQuickStart && (
          <button
            type="button"
            onClick={onQuickStart}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          >
            {t('se.hub.quickStart')}
          </button>
        )}
        {onCloneUrl && (
          <button
            type="button"
            onClick={onCloneUrl}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            {t('se.hub.cloneUrl')}
          </button>
        )}
      </div>
    </div>
  )
}
