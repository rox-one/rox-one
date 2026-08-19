/**
 * PanelHost render for `knowledge.inspector`.
 *
 * PanelHost invokes `panel.render` with no props, so this component reads the
 * focused panel route itself and hands a companion ref to KnowledgeInspector.
 */
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { focusedPanelRouteAtom } from '@/atoms/panel-stack'
import { KnowledgeInspector } from '@/knowledge/KnowledgeInspector'
import { knowledgeCompanionRefFromRoute } from './core-panels'

export function KnowledgeInspectorPanel() {
  const { t } = useTranslation()
  const route = useAtomValue(focusedPanelRouteAtom)
  const knowledgeRef = knowledgeCompanionRefFromRoute(route)
  return (
    <aside
      className="w-[320px] shrink-0 overflow-y-auto border-l border-border/60 bg-muted/[0.12]"
      aria-label={t('knowledge.inspector.title')}
    >
      <KnowledgeInspector knowledgeRef={knowledgeRef} />
    </aside>
  )
}
