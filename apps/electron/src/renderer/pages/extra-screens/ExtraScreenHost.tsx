/**
 * Mounts one extra workbench screen by id. A disabled flag shows an honest
 * «screen is off» state instead of a blank panel.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { extraScreenFlagAtoms } from '@/atoms/extra-screens'
import { navigate, routes } from '@/lib/navigate'
import type { ExtraScreenId } from '../../../shared/extra-screens'
import { extraScreenDef } from './registry'
import { EmptyState, ScreenButton } from './ui'

const PAGES: Record<ExtraScreenId, React.LazyExoticComponent<React.ComponentType<{ itemId: string | null }>>> = {
  dossier: React.lazy(() => import('./dossier/DossierPage')),
  radar: React.lazy(() => import('./radar/RadarPage')),
  decisions: React.lazy(() => import('./decisions/DecisionsPage')),
}

export interface ExtraScreenHostProps {
  screen: ExtraScreenId
  itemId: string | null
}

export default function ExtraScreenHost({ screen, itemId }: ExtraScreenHostProps) {
  const { t } = useTranslation()
  const enabled = useAtomValue(extraScreenFlagAtoms[screen])
  const def = extraScreenDef(screen)
  if (!enabled || !def) {
    return (
      <EmptyState
        title={t('extraScreens.disabledTitle', { name: def ? t(def.labelKey) : screen })}
        body={t('extraScreens.disabledBody')}
        action={
          <ScreenButton onClick={() => navigate(routes.view.settings('appearance'))}>
            {t('extraScreens.openSettings')}
          </ScreenButton>
        }
      />
    )
  }
  const Page = PAGES[screen]
  return (
    <React.Suspense fallback={null}>
      <Page itemId={itemId} />
    </React.Suspense>
  )
}
