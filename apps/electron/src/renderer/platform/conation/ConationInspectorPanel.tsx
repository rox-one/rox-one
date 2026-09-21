/**
 * Conation inspector host — framed chrome until domain panes land.
 */
import { useTranslation } from 'react-i18next'
import { RADIUS_INNER } from '@/components/app-shell/panel-constants'
import { CONATION_INSPECTOR_PLACEHOLDER } from './conation-inspector-model'

export function ConationInspectorPanel() {
  const { t } = useTranslation()
  return (
    <aside
      className="mt-0.5 mb-0.5 mr-0.5 flex w-[320px] shrink-0 flex-col overflow-hidden border border-border/50 bg-background shadow-middle"
      style={{ borderRadius: RADIUS_INNER }}
      data-testid="conation-inspector-placeholder"
      aria-label="Conation"
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border/40 px-3">
        <span className="chrome-label truncate text-xs font-medium tracking-tight text-foreground/80">
          {t('inspector.tab.context', { defaultValue: 'Контекст' })}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{CONATION_INSPECTOR_PLACEHOLDER}</p>
      </div>
    </aside>
  )
}
