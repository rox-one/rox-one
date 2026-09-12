import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { ExplainerNode } from '@craft-agent/shared/code-intelligence'

export function RepoArchitectureExplainer({ nodes }: { nodes: ExplainerNode[] }) {
  const { t } = useTranslation()

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('codeIntel.empty')}</p>
  }

  return (
    <section aria-label={t('codeIntel.title')} className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{t('codeIntel.title')}</h2>
      <ul className="flex flex-col gap-1">
        {nodes.map((node) => (
          <li key={node.id} className="text-xs font-mono">
            <span>{node.label}</span>
            <span className="text-muted-foreground"> {t('codeIntel.citation')}: {node.citation}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
