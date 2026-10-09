/**
 * KnowledgeMapDocView — renders a knowledge-map document node with the
 * `@rox/ui` Markdown renderer. Content is read through EXISTING APIs only:
 * context docs via `readContextDoc`, notes via `readNote`, memory files via
 * `getConfigDir` + `readFile`. When a source cannot be read the view shows an
 * explicit unavailable state — nothing is fabricated.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FileWarning } from 'lucide-react'
import { Markdown, Spinner } from '@rox/ui'
import type { KnowledgeMapNode } from '@rox/shared/knowledge/knowledge-map-types'
import { toErrorMessage } from '@/lib/errors'

interface KnowledgeMapDocViewProps {
  node: KnowledgeMapNode | null
  workspaceId: string | null
}

type DocSource = () => Promise<string>

function resolveDocSource(node: KnowledgeMapNode, workspaceId: string | null): DocSource | null {
  const relPath = node.relPath
  if (!relPath) return null
  if (node.area === 'context') {
    return async () => (await window.electronAPI.readContextDoc(relPath)).content
  }
  if (node.area === 'notes') {
    if (!workspaceId) return null
    const noteId = relPath.replace(/\.md$/i, '').replace(/^\/+/, '')
    return async () => (await window.electronAPI.readNote(workspaceId, noteId)).content
  }
  if (node.area === 'memory') {
    return async () => {
      const configDir = await window.electronAPI.getConfigDir()
      const separator = configDir.includes('\\') && !configDir.includes('/') ? '\\' : '/'
      const base = configDir.endsWith('/') || configDir.endsWith('\\') ? configDir : `${configDir}${separator}`
      return window.electronAPI.readFile(`${base}memory${separator}${relPath}`)
    }
  }
  return null
}

export function KnowledgeMapDocView({ node, workspaceId }: KnowledgeMapDocViewProps) {
  const { t } = useTranslation()
  const [content, setContent] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!node) {
      setContent(null)
      setError(null)
      setLoading(false)
      return
    }
    const source = resolveDocSource(node, workspaceId)
    if (!source) {
      setContent(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setContent(null)
    setError(null)
    source()
      .then((text) => {
        if (!cancelled) setContent(text)
      })
      .catch((cause) => {
        if (!cancelled) setError(toErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [node, workspaceId])

  if (!node) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{t('knowledgeMap.unavailable')}</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h4 className="truncate text-sm font-medium" title={node.relPath ?? node.label}>
          {node.label}
        </h4>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t('knowledgeMap.node.links', { count: node.linkCount })}
        </span>
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="w-4 h-4" />
        </div>
      ) : error ? (
        <p className="px-1 py-6 text-sm text-muted-foreground" role="alert">
          {t('knowledgeMap.error')}
        </p>
      ) : content === null ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
          <FileWarning className="icon-toolbar" aria-hidden />
          <span>{t('knowledgeMap.unavailable')}</span>
        </div>
      ) : (
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <Markdown mode="minimal">{content}</Markdown>
        </div>
      )}
    </div>
  )
}

export default KnowledgeMapDocView