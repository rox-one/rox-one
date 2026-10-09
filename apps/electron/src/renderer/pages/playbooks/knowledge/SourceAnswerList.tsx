/**
 * Source-grounded answer view (С-13, D12): question + retrieved source hits as
 * citations (`path` + snippet), mirroring the code-intelligence citation shape
 * (`CodeCitation`: path/range). Retrieval is `sources:search`.
 */
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import type { SourceIndexHit } from './useSourceIndex'

export function SourceAnswerList({ question, hits }: { question: string; hits: readonly SourceIndexHit[] }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 py-3" data-testid="playbooks-notebook-answer">
      <p className="text-xs font-medium">{question}</p>
      <p className="text-caption text-muted-foreground">{t('playbooks.notebook.answerSources', { count: hits.length })}</p>
      <ul className="list-none space-y-1.5 p-0">
        {hits.map((hit) => (
          <li key={`${hit.path}:${hit.rank}`} className="rounded-[var(--radius-control)] border border-border-subtle p-2" data-testid="playbooks-notebook-citation">
            <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <FileText className="icon-caption" aria-hidden />
              <span className="truncate" title={hit.path}>{hit.path}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs">{hit.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}