/**
 * When the knowledge entity surface should show the inspector + agent CTAs.
 * Document/block only — notebooks, databases, and the compat full-UI are not
 * “this document”.
 */
import type { KnowledgeRef, KnowledgeRefKind } from '../../shared/types'
import { SIYUAN_FULL_SURFACE_ID } from './siyuan-url'

const COMPANION_KINDS = new Set<KnowledgeRefKind>(['document', 'block'])

export function knowledgeEntityCompanionRef(
  kind: KnowledgeRefKind,
  id: string,
): KnowledgeRef | null {
  if (!id || id === SIYUAN_FULL_SURFACE_ID) return null
  if (!COMPANION_KINDS.has(kind)) return null
  return { scheme: 'siyuan', kind, id }
}
