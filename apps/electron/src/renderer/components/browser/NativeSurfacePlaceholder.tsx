import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { NativeSurfacePresentation } from '@/hooks/useNativeSurfaceBounds'

/** The native instance stays alive while clipping or another panel owns focus. */
export function NativeSurfacePlaceholder({ presentation, surfaceRef }: {
  presentation: NativeSurfacePresentation
  surfaceRef: RefObject<HTMLDivElement>
}) {
  const { t } = useTranslation()
  if (presentation !== 'clipped' && presentation !== 'unfocused') return null
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center text-muted-foreground">
      <p className="text-xs">{t(presentation === 'clipped' ? 'nativeSurface.notFullyVisible' : 'nativeSurface.focusToShow')}</p>
      <button
        type="button"
        className="rox-control rounded-md border border-border px-3 text-xs outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          const panel = surfaceRef.current?.closest<HTMLElement>('[data-panel-id]') ?? surfaceRef.current
          panel?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
          panel?.focus({ preventScroll: true })
        }}
      >
        {t('nativeSurface.showPanel')}
      </button>
    </div>
  )
}
