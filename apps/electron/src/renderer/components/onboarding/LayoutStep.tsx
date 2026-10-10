/**
 * LayoutStep — first-run «choose your starting layout» (G4 «Студия»).
 *
 * Inserted by `useOnboarding` after the profile questions and before the finish
 * step, only when the layout-engine flag is ON. The choice becomes the default
 * preset for new workspaces, stored through the layout-defaults module; the
 * four named arrangements reuse the deck's `layout.deck.preset.*` labels so the
 * preview vocabulary stays identical to the ⌘\ deck.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { BackButton, ContinueButton, StepFormLayout } from './primitives'
import { getDefaultLayoutPreset, setDefaultLayoutPreset } from '@/lib/layout-defaults'

/** The four named arrangements offered as a starting layout (deck order). */
const STARTING_PRESETS = ['focus', 'dialog', 'triptych', 'wall'] as const
type StartingPreset = typeof STARTING_PRESETS[number]

interface LayoutStepProps {
  onContinue: () => void
  onBack?: () => void
}

export function LayoutStep({ onContinue, onBack }: LayoutStepProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<StartingPreset>(() => {
    const current = getDefaultLayoutPreset()
    return current && current !== 'auto' ? current : 'focus'
  })

  const submit = () => {
    setDefaultLayoutPreset(selected)
    onContinue()
  }

  const title = t('onboarding.layout.title')

  return (
    <StepFormLayout
      title={title}
      description={t('onboarding.layout.hint')}
      actions={
        <>
          {onBack && <BackButton onClick={onBack} />}
          <ContinueButton type="button" onClick={submit}>
            {t('common.continue')}
          </ContinueButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-left" role="radiogroup" aria-label={title}>
        {STARTING_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={selected === preset}
            onClick={() => setSelected(preset)}
            className={cn(
              'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              selected === preset
                ? 'border-accent bg-accent/10'
                : 'border-transparent bg-foreground-2 hover:bg-surface-hover',
            )}
          >
            <span className="font-medium">
              {t(`layout.deck.preset.${preset}`, { defaultValue: preset })}
            </span>
          </button>
        ))}
      </div>
    </StepFormLayout>
  )
}