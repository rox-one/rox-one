/**
 * KnowledgeAgentPanel — compact agent companion for the knowledge surface (W2).
 *
 * Shows the current document as context and offers two live CTAs that create an
 * agent session WITH the document attached:
 * - "Ask about this document": creates a session and pre-fills the composer
 *   (action/new-session?input=… — the user reviews and sends).
 * - "Open full session": creates a session and sends a context brief
 *   immediately (action/new-session?input=…&send=true).
 *
 * The document survives session creation as a verbatim [knowledge:…] mention
 * token: the new session's composer renders it as a knowledge badge, and the
 * agent resolves it with the knowledge_read session tool (its description
 * documents the mention form). This is the existing new-session route seam —
 * no new session-creation channel.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes, type Route } from '@/lib/navigate'
import { useKnowledgeNode } from './use-knowledge-node'
import type { KnowledgeRef } from '../../shared/types'

export interface KnowledgeAgentPanelProps {
  knowledgeRef: KnowledgeRef | null
}

/**
 * '@siyuan/document/<id>' — mirrors formatKnowledgeDisplay from @craft-agent/core/knowledge,
 * inlined here because apps/electron does not take a runtime dependency on @craft-agent/core
 * (shared/types.ts documents this boundary).
 */
function formatKnowledgeDisplay(ref: KnowledgeRef): string {
  return `@${ref.provider ?? ref.scheme}/${ref.kind}/${ref.id}`
}

/** Full-form [knowledge:<provider>/<kind>/<id>] mention token for a ref. */
export function knowledgeMentionToken(ref: KnowledgeRef): string {
  return `[knowledge:${ref.provider ?? ref.scheme}/${ref.kind}/${ref.id}]`
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * Composer prefill for "Ask about this document": mention token first (it
 * renders as the knowledge badge), then a stem the user completes. The title
 * slot falls back to the '@provider/kind/id' display form when the node has
 * not loaded yet — never an empty hole in the sentence.
 */
export function buildAskAboutPrefill(
  ref: KnowledgeRef,
  title: string | null,
  t: Translate,
): string {
  return t('knowledge.agent.askPrefill', {
    mention: knowledgeMentionToken(ref),
    title: title ?? formatKnowledgeDisplay(ref),
  })
}

/**
 * Auto-sent brief for "Open full session": grounds the fresh session in the
 * document via the knowledge_read tool (snapshot context), then waits for the
 * user's questions.
 */
export function buildOpenSessionBrief(
  ref: KnowledgeRef,
  title: string | null,
  t: Translate,
): string {
  return t('knowledge.agent.openSessionBrief', {
    mention: knowledgeMentionToken(ref),
    title: title ?? formatKnowledgeDisplay(ref),
  })
}

/** Existing new-session route: composer prefill, user reviews and sends. */
export function buildAskAboutSessionRoute(
  ref: KnowledgeRef,
  title: string | null,
  t: Translate,
): Route {
  return routes.action.newSession({
    input: buildAskAboutPrefill(ref, title, t),
    ...(title ? { name: title } : {}),
  })
}

/** Existing new-session route: create the session and send the brief immediately. */
export function buildOpenSessionRoute(
  ref: KnowledgeRef,
  title: string | null,
  t: Translate,
): Route {
  return routes.action.newSession({
    input: buildOpenSessionBrief(ref, title, t),
    send: true,
    ...(title ? { name: title } : {}),
  })
}

export function KnowledgeAgentPanel({ knowledgeRef }: KnowledgeAgentPanelProps) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { node, loading } = useKnowledgeNode(knowledgeRef)

  if (!knowledgeRef) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-medium">{t('knowledge.inspector.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('knowledge.openFullInterface')}</p>
      </div>
    )
  }

  const displayRef = formatKnowledgeDisplay(knowledgeRef)
  const title = node?.title ?? null

  const handleAskAbout = () => {
    navigate(buildAskAboutSessionRoute(knowledgeRef, title, t))
  }

  const handleOpenSession = () => {
    navigate(buildOpenSessionRoute(knowledgeRef, title, t))
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={node?.title ?? displayRef}>
          {loading && !node ? t('knowledge.surface.loading') : (node?.title ?? displayRef)}
        </p>
        <p className="truncate text-xs text-muted-foreground">{displayRef}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button size="sm" onClick={handleAskAbout}>
          {t('knowledge.agent.askAbout')}
        </Button>
        <Button size="sm" variant="outline" onClick={handleOpenSession}>
          {t('knowledge.agent.openFullSession')}
        </Button>
      </div>
    </div>
  )
}
