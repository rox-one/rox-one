/**
 * Lenient ref-string parser for the knowledge session tools.
 *
 * Models hand refs to tools in whatever form they last saw them — search-hit
 * provenance lines, [knowledge:…] mentions in chat text, or siyuan:// deep links.
 * All accepted forms funnel through the canonical grammar in
 * @craft-agent/core/knowledge refs.ts (parseKnowledgeRef / parseSiyuanDeepLink);
 * this module only strips the mention wrapper. Unknown shapes → null (callers
 * raise a typed INVALID_REF listing the accepted forms).
 */

import { parseKnowledgeRef, parseSiyuanDeepLink } from '@craft-agent/core/knowledge';
import type { KnowledgeRef } from '@craft-agent/core/knowledge';

/** Human/agent-readable list of accepted ref forms (used in INVALID_REF errors). */
export const KNOWLEDGE_REF_ACCEPTED_FORMS =
  '[knowledge:document/<id>], siyuan://blocks/<id>, siyuan/<kind>/<id>, or <kind>/<id> ' +
  "(kind: 'notebook' | 'document' | 'block' | 'database' | 'asset')";

export function parseKnowledgeRefArg(input: unknown): KnowledgeRef | null {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;

  // Strip the mention wrapper: [knowledge:…] (optional provider segment inside).
  const mention = /^\[knowledge:(.+)\]$/.exec(text);
  if (mention?.[1]) text = mention[1];

  if (text.startsWith('siyuan://')) {
    return parseSiyuanDeepLink(text);
  }
  return parseKnowledgeRef(text);
}
