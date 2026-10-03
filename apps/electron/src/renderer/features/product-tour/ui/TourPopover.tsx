import { forwardRef, useId, useMemo, type MouseEvent, type RefObject } from 'react'
import * as Popper from '@radix-ui/react-popper'
import { useTranslation } from 'react-i18next'
import type { TourBinding, TourStep, TourTargetRegistration } from '../contracts'
import type { TargetGeometry } from './geometry'

export interface TourPopoverProps {
  readonly target: TourTargetRegistration
  readonly step: TourStep
  readonly binding: TourBinding
  readonly geometry: TargetGeometry
  readonly onNext?: () => void
  readonly onBack?: () => void
  readonly onSkip?: () => void
  readonly onPause: () => void
  readonly onDismiss?: () => void
  readonly canNext?: boolean
}

/** Radix positioning without its capture-phase Escape handler or a modal FocusScope. */
export const TourPopover = forwardRef<HTMLDivElement, TourPopoverProps>(function TourPopover({ target, step, binding, geometry, onNext, onBack, onSkip, onPause, onDismiss, canNext = true }, ref) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const copyPrefix = step.copyKey.replace(/\.$/, '')
  const virtualRef = useMemo(() => ({ current: { getBoundingClientRect: () => geometry.rect } }), [geometry])
  const action = (callback: () => void) => (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); callback() }
  const focusTarget = () => {
    const element = target.element
    const focusable = element.matches('button, a[href], input, textarea, select, [tabindex], [contenteditable="true"]')
      ? element : element.querySelector<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')
    if (focusable) focusable.focus({ preventScroll: true })
    else {
      // A host boundary is focusable only after the explicit "go to element" action.
      element.setAttribute('tabindex', '-1')
      element.focus({ preventScroll: true })
      element.removeAttribute('tabindex')
    }
  }
  const buttonClass = 'rounded-md px-2 py-1.5 text-sm hover:bg-foreground/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50'
  return (
    <Popper.Root>
      <Popper.Anchor virtualRef={virtualRef as RefObject<{ getBoundingClientRect(): DOMRect }>} />
      <Popper.Content
        ref={ref}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        side="bottom"
        align="start"
        sideOffset={16}
        collisionPadding={16}
        avoidCollisions
        sticky="always"
        className="popover-styled z-dropdown w-80 max-w-[calc(100vw-32px)] max-h-[calc(100dvh-32px)] overflow-y-auto p-4 outline-none motion-reduce:transition-none motion-reduce:animate-none"
        data-product-tour-popover=""
        data-product-tour-step={step.id}
        data-product-tour-target={target.id}
        data-product-tour-run={binding.runToken}
        onKeyDown={(event) => { if (event.key === 'Enter') event.stopPropagation() }}
      >
        <h2 id={titleId} className="mb-2 text-sm font-semibold">{t(`${copyPrefix}.title`)}</h2>
        <p id={descriptionId} className="text-sm text-muted-foreground whitespace-pre-line break-words">{t(`${copyPrefix}.body`)}</p>
        <button type="button" className={`${buttonClass} mt-3 text-accent`} onClick={action(focusTarget)}>
          {t('productTour.controls.focusTarget')}
        </button>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {onBack && <button type="button" className={buttonClass} onClick={action(onBack)}>{t('productTour.controls.back')}</button>}
          {onSkip && <button type="button" className={buttonClass} onClick={action(onSkip)}>{t('productTour.controls.skip')}</button>}
          <button type="button" className={buttonClass} onClick={action(onPause)}>{t('productTour.controls.pause')}</button>
          {onDismiss && <button type="button" className={buttonClass} onClick={action(onDismiss)}>{t('productTour.controls.dismiss')}</button>}
          {onNext && <button type="button" className={`${buttonClass} ml-auto bg-foreground text-background hover:bg-foreground/90`} disabled={!canNext} onClick={action(onNext)}>{t('productTour.controls.next')}</button>}
        </div>
      </Popper.Content>
    </Popper.Root>
  )
})
