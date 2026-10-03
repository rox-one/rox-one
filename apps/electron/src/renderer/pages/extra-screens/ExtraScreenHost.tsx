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
import { lazyRoutePage } from '../../components/app-shell/MainContentPanel'

const PAGES: Record<ExtraScreenId, React.ComponentType<{ itemId: string | null }>> = {
  dossier: lazyRoutePage(() => import('./dossier/DossierPage')),
  radar: lazyRoutePage(() => import('./radar/RadarPage')),
  decisions: lazyRoutePage(() => import('./decisions/DecisionsPage')),
  agents: lazyRoutePage(() => import('./agents/AgentCenterPage')),
  focus: lazyRoutePage(() => import('./focus/FocusPage')),
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
