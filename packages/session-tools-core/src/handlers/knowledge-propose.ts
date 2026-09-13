/**
 * knowledge_propose — P3 write-back: create a mutation proposal. Does NOT apply.
 *
 * The agent may draft a whitelist op batch. Approval and apply stay human-only
 * (spec 05 §3.6). Explore/Safe mode blocks this tool via SESSION_TOOL_DEFS.safeMode.
 */

import type { MutationInput, MutationOp, MutationProposal } from '@craft-agent/core/knowledge';
import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  deepLinkFor,
  formatRef,
  knowledgeErrorResponse,
  provenanceLine,
  requireKnowledgeRuntime,
} from '../knowledge/format.ts';
import {
  KNOWLEDGE_REF_ACCEPTED_FORMS,
  parseKnowledgeRefArg,
} from '../knowledge/parse-ref.ts';
import type { KnowledgeProposeArgs } from '../tool-defs.ts';

const OP_KINDS = new Set(['createDocument', 'appendBlock', 'updateBlock', 'setAttribute']);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function parseProposeOps(raw: unknown): MutationOp[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'knowledge_propose requires a non-empty "ops" array.' };
  }
  const ops: MutationOp[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `knowledge_propose ops[${index}] must be an object.` };
    }
    const record = entry as Record<string, unknown>;
    const kind = record.op;
    if (typeof kind !== 'string' || !OP_KINDS.has(kind)) {
      return { error: `knowledge_propose ops[${index}].op must be one of createDocument, appendBlock, updateBlock, setAttribute.` };
    }
    if (kind === 'createDocument') {
      const notebook = asNonEmptyString(record.notebook);
      const path = asNonEmptyString(record.path);
      const title = asNonEmptyString(record.title);
      const markdown = typeof record.markdown === 'string' ? record.markdown : null;
      if (!notebook || !path || !title || markdown === null) {
        return { error: `knowledge_propose ops[${index}] createDocument needs notebook, path, title, markdown.` };
      }
      ops.push({ op: 'createDocument', notebook, path, title, markdown });
      continue;
    }
    if (kind === 'appendBlock') {
      const documentId = asNonEmptyString(record.documentId);
      const markdown = typeof record.markdown === 'string' ? record.markdown : null;
      if (!documentId || markdown === null) {
        return { error: `knowledge_propose ops[${index}] appendBlock needs documentId and markdown.` };
      }
      ops.push({ op: 'appendBlock', documentId, markdown });
      continue;
    }
    if (kind === 'updateBlock') {
      const blockId = asNonEmptyString(record.blockId);
      const markdown = typeof record.markdown === 'string' ? record.markdown : null;
      if (!blockId || markdown === null) {
        return { error: `knowledge_propose ops[${index}] updateBlock needs blockId and markdown.` };
      }
      ops.push({ op: 'updateBlock', blockId, markdown });
      continue;
    }
    const blockId = asNonEmptyString(record.blockId);
    const name = asNonEmptyString(record.name);
    const value = typeof record.value === 'string' ? record.value : null;
    if (!blockId || !name || value === null) {
      return { error: `knowledge_propose ops[${index}] setAttribute needs blockId, name, value.` };
    }
    ops.push({ op: 'setAttribute', blockId, name, value });
  }
  return ops;
}

function formatProposal(proposal: MutationProposal, connectionId: string): string {
  const lines = [
    '## Knowledge proposal (not applied)',
    provenanceLine(connectionId),
    `proposalId: ${proposal.id}`,
    `status: ${proposal.status}`,
    `ref: ${formatRef(proposal.targetRef)}`,
    `link: ${deepLinkFor(proposal.targetRef)}`,
    `ops: ${proposal.ops.map((op) => op.op).join(', ')}`,
  ];
  if (proposal.baseHash) lines.push(`baseHash: ${proposal.baseHash}`);
  lines.push('', 'This draft is waiting for the user to approve in Knowledge. Do not claim the write landed.');
  return lines.join('\n');
}

export async function handleKnowledgePropose(
  ctx: SessionToolContext,
  args: KnowledgeProposeArgs,
): Promise<ToolResult> {
  const ref = parseKnowledgeRefArg(args?.ref);
  if (!ref) {
    return errorResponse(
      `INVALID_REF: knowledge_propose could not parse ref ${JSON.stringify(args?.ref)}. ` +
        `Accepted forms: ${KNOWLEDGE_REF_ACCEPTED_FORMS}`,
    );
  }
  const parsedOps = parseProposeOps(args?.ops);
  if ('error' in parsedOps) return errorResponse(`INVALID_REF: ${parsedOps.error}`);

  const resolved = requireKnowledgeRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;
  if (typeof runtime.propose !== 'function') {
    return errorResponse(
      'CAPABILITY_DISABLED: knowledge_propose is unavailable — the knowledge runtime has no propose seam. Reads still work.',
    );
  }

  const input: MutationInput = {
    targetRef: ref,
    ops: parsedOps,
    actor: 'agent',
    sessionId: ctx.sessionId,
    ...(typeof args.summary === 'string' && args.summary.trim()
      ? { summary: args.summary.trim() }
      : {}),
    ...(typeof args.baseHash === 'string' && args.baseHash
      ? { baseHash: args.baseHash }
      : {}),
  };

  try {
    const proposal = await runtime.propose({
      input,
      ...(typeof args.connectionId === 'string' && args.connectionId
        ? { connectionId: args.connectionId }
        : {}),
    });
    const connectionId =
      (typeof args.connectionId === 'string' && args.connectionId) ||
      runtime.defaultConnectionId?.() ||
      proposal.connectionId;
    return successResponse(formatProposal(proposal, connectionId));
  } catch (error) {
    return knowledgeErrorResponse(error);
  }
}
