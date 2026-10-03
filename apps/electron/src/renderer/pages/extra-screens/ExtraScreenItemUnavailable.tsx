import { useTranslation } from 'react-i18next'
import { navigate, routes } from '@/lib/navigate'
import type { ExtraScreenId } from '../../../shared/extra-screens'
import { EmptyState, ScreenButton } from './ui'

/** A requested item stays distinct from the screen's unselected empty state. */
export function ExtraScreenItemUnavailable({ screen, itemId }: { screen: ExtraScreenId; itemId: string }) {
  const { t } = useTranslation()
  return (
    <div className="h-full" data-testid="extra-screen-item-unavailable" data-screen={screen} data-item-id={itemId}>
      <EmptyState
        title={t('common.unavailable')}
        action={<ScreenButton onClick={() => navigate(routes.view.screen(screen))}>{t('common.backToList')}</ScreenButton>}
      />
    </div>
  )
}
