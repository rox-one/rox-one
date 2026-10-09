/**
 * Preset questions (С-13, D12) — a fixed list over the loaded sources; a click
 * runs the `sources:search` retrieval. Motion respects reduced-motion via the
 * shared tokens utilities.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Preset ids → literal keys `playbooks.notebook.presets.<id>`. */
export const PRESET_QUESTION_IDS = ['summarize', 'keyTopics', 'actions', 'risks', 'entities'] as const
export type PresetQuestionId = (typeof PRESET_QUESTION_IDS)[number]

export function PresetQuestions({ disabled, onSelect }: { disabled: boolean; onSelect: (id: PresetQuestionId) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  return (
    <div className="px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="playbooks-notebook-presets-toggle"
      >
        <ChevronRight className={cn('icon-caption transition-transform duration-[var(--motion-base)] motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
        <ListChecks className="icon-caption" aria-hidden />
        {t('playbooks.notebook.presetsTitle')}
      </button>
      {open ? (
        <ul className="mt-1 list-none space-y-0.5 p-0" data-testid="playbooks-notebook-presets">
          {PRESET_QUESTION_IDS.map((id) => (
            <li key={id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(id)}
                className={cn(
                  'w-full rounded-[var(--radius-control)] px-2 py-1 text-left text-xs transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                  'hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
                )}
                data-testid={`playbooks-notebook-preset-${id}`}
              >
                {t(`playbooks.notebook.presets.${id}`)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}