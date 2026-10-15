/** Titlebar toggle + ⌘⌥\ for split mode (top50 #13). */
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Columns2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@rox/ui/tooltip'
import { useAction, useActionLabel } from '@/actions'
import { cn } from '@/lib/utils'
import { activeSplitIdsAtom, toggleSplitAtom } from './split-mode'

export function SplitToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const active = useAtomValue(activeSplitIdsAtom) !== null
  const toggle = useSetAtom(toggleSplitAtom)
  useAction('view.toggleSplit', () => { toggle() })
  const hotkey = useActionLabel('view.toggleSplit').hotkey
  const label = t(active ? 'shell.split.exit' : 'shell.split.enter')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          data-split-toggle={active ? 'on' : 'off'}
          onClick={() => toggle()}
          className={cn(
            'titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring',
            active ? 'bg-accent/10 text-accent' : 'text-text-secondary',
            className,
          )}
        >
          <Columns2 className="icon-toolbar" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}{hotkey ? ` ${hotkey}` : ''}</TooltipContent>
    </Tooltip>
  )
}
