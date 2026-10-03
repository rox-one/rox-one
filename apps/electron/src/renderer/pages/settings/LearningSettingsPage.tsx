import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { productTourCatalogue } from '@/features/product-tour/catalogue'
import { useProductLearning } from '@/features/product-tour/runtime'
import { useTourTarget } from '@/features/product-tour/runtime/hooks'

export const meta = { navigator: 'settings', slug: 'learning' } as const
export default function LearningSettingsPage() {
  const { t } = useTranslation()
  const learning = useProductLearning()
  const libraryTarget = useTourTarget('learning.library')
  const preferencesTarget = useTourTarget('learning.preferences')
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const scrollContainer = useRef<HTMLDivElement>(null)
  return <div data-testid="learning-settings" className="flex h-full min-h-0 flex-col">
    <div ref={libraryTarget}><PanelHeader title={t('settings.learning.title')} /></div>
    <div ref={scrollContainer} className="min-h-0 flex-1 overflow-auto p-5">
      <p className="mb-5 text-sm text-muted-foreground">{t('productTour.localOnly')}</p>
      <section ref={preferencesTarget} className="mb-6 space-y-3 rounded-xl border p-4">
        <label className="flex items-center gap-3"><input data-testid="learning-enable" type="checkbox" checked={learning?.enabled ?? false} onChange={event => learning?.setEnabled(event.target.checked)} />{t('productTour.controls.enabled')}</label>
        {learning?.enabled && <>
          <label className="flex items-center gap-3"><input type="checkbox" checked={learning.preferences.invitationsEnabled} onChange={event => void learning.setPreferences({ invitationsEnabled: event.target.checked })} />{t('productTour.controls.invitations')}</label>
          <label className="flex items-center gap-3"><input type="checkbox" checked={learning.preferences.diagnosticsEnabled} onChange={event => void learning.setPreferences({ diagnosticsEnabled: event.target.checked })} />{t('productTour.controls.diagnostics')}</label>
          <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>{t('productTour.controls.reset')}</Button>
        </>}
        {learning?.storageStatus !== 'saved' && learning?.enabled && <p role="alert">{t('productTour.storageUnavailable')}</p>}
      </section>
      <section className="space-y-3">
        {productTourCatalogue.map(tour => {
          const progress = learning?.progress[tour.id]
          const steps = Object.values(progress?.steps ?? {})
          const acknowledged = steps.filter(item => item?.acknowledgedAt !== undefined).length
          const verified = steps.filter(item => item?.verifiedAt !== undefined).length
          const blocked = tour.requires.map(id => learning?.capabilities[id]).find(capability => capability && capability.state !== 'ready')
          const reason = blocked && blocked.state !== 'ready' ? blocked.reason : null
          return <article data-testid={`learning-tour-${tour.id}`} key={tour.id} className="rounded-xl border p-4">
            <h2 className="font-semibold">{t(tour.titleKey)}</h2>
            <p className="mt-1 text-sm">{t(tour.goalKey)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t(tour.whyKey)}</p>
            <p className="mt-2 text-xs">{t('productTour.acknowledged')}: {acknowledged}/{tour.steps.length} · {t('productTour.verified')}: {verified}/{tour.steps.length}</p>
            {reason && <p className="mt-2 text-xs text-muted-foreground">{t('productTour.prerequisites')}: {t(`productTour.reasons.${reason}`)}</p>}
            <div className="mt-3 flex gap-2">
              <Button type="button" data-testid={`learning-start-${tour.id}`} disabled={!learning?.enabled || !learning.ready} onClick={() => { scrollContainer.current?.scrollTo({ top: 0 }); void learning?.start(tour.id, progress ? 'resume' : 'new') }}>{t(progress ? 'productTour.controls.resume' : 'productTour.controls.start')}</Button>
              {progress && <Button type="button" variant="outline" disabled={!learning?.enabled || !learning.ready} onClick={() => { scrollContainer.current?.scrollTo({ top: 0 }); void learning?.start(tour.id, 'replay') }}>{t('productTour.controls.replay')}</Button>}
            </div>
          </article>
        })}
      </section>
    </div>
    <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
      <DialogContent><DialogHeader><DialogTitle>{t('productTour.controls.confirmReset')}</DialogTitle><DialogDescription>{t('productTour.localOnly')}</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setConfirmReset(false)}>{t('productTour.controls.cancel')}</Button><Button type="button" disabled={resetting} onClick={() => { setResetting(true); void learning?.reset().finally(() => { setResetting(false); setConfirmReset(false) }) }}>{t('productTour.controls.reset')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
