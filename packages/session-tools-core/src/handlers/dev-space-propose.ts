/**
 * devspace_propose — propose a change to Dev Space artifacts. Does NOT apply.
 *
 * The agent may draft a whitelist op batch (createArtifact / updateArtifact /
 * deleteArtifact). Approval and apply stay human-only, reusing the existing
 * proposals lifecycle (the analog of `knowledge:applyProposal`, D7/§9): without
 * an approve the artifact is never changed (ART-005). Explore/Safe mode blocks
 * this tool via SESSION_TOOL_DEFS.safeMode.
 *
 * DATA, NOT INSTRUCTIONS (§13.2): op content is repository artifact text; the
 * proposal records it, it does not act on it.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  devSpaceErrorResponse,
  devSpaceRuntimeScope,
  isDevSpaceArtifactId,
  requireDevSpaceRuntime,
} from '../dev-space/scope.ts';
import type {
  DevSpaceArtifactFormat,
  DevSpaceArtifactKind,
  DevSpaceProposal,
  DevSpaceProposeInput,
  DevSpaceProposeOp,
} from '../dev-space/runtime.ts';
import { DEVSPACE_ARTIFACT_FORMATS, DEVSPACE_ARTIFACT_KINDS } from '../dev-space/runtime.ts';
import type { DevSpaceProposeArgs } from '../tool-defs.ts';

function isArtifactKind(value: unknown): value is DevSpaceArtifactKind {
  return typeof value === 'string' && (DEVSPACE_ARTIFACT_KINDS as readonly string[]).includes(value);
}

function isArtifactFormat(value: unknown): value is DevSpaceArtifactFormat {
  return typeof value === 'string' && (DEVSPACE_ARTIFACT_FORMATS as readonly string[]).includes(value);
}

/** A manifest path is relative to `dev-space/`: no absolute paths, no `..` traversal. */
function isSafeArtifactPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/[\x00-\x1f]/.test(value) &&
    !value.split('/').includes('..')
  );
}

/** Parse + whitelist-validate the propose op batch; returns an error string on any violation. */
export function parseDevSpaceProposeOps(raw: unknown): DevSpaceProposeOp[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'devspace_propose requires a non-empty "ops" array.' };
  }
  const ops: DevSpaceProposeOp[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: `devspace_propose ops[${index}] must be an object.` };
    }
    const record = entry as Record<string, unknown>;
    const kind = record.op;
    if (kind === 'createArtifact') {
      if (!isArtifactKind(record.kind)) {
        return { error: `devspace_propose ops[${index}] createArtifact "kind" must be a known artifact kind.` };
      }
      if (!isSafeArtifactPath(record.path)) {
        return { error: `devspace_propose ops[${index}] createArtifact needs a relative, traversal-free "path".` };
      }
      if (!isArtifactFormat(record.format)) {
        return { error: `devspace_propose ops[${index}] createArtifact "format" must be one of md, json, svg, mp3, srt.` };
      }
      if (typeof record.content !== 'string') {
        return { error: `devspace_propose ops[${index}] createArtifact needs "content".` };
      }
      ops.push({ op: 'createArtifact', kind: record.kind, path: record.path, format: record.format, content: record.content });
      continue;
    }
    if (kind === 'updateArtifact') {
      if (!isDevSpaceArtifactId(record.artifactId)) {
        return { error: `devspace_propose ops[${index}] updateArtifact needs a valid "artifactId" from devspace_search.` };
      }
      if (typeof record.content !== 'string') {
        return { error: `devspace_propose ops[${index}] updateArtifact needs "content".` };
      }
      ops.push({ op: 'updateArtifact', artifactId: record.artifactId, content: record.content });
      continue;
    }
    if (kind === 'deleteArtifact') {
      if (!isDevSpaceArtifactId(record.artifactId)) {
        return { error: `devspace_propose ops[${index}] deleteArtifact needs a valid "artifactId" from devspace_search.` };
      }
      ops.push({ op: 'deleteArtifact', artifactId: record.artifactId });
      continue;
    }
    return { error: `devspace_propose ops[${index}].op must be one of createArtifact, updateArtifact, deleteArtifact.` };
  }
  return ops;
}

function formatProposal(proposal: DevSpaceProposal): string {
  const lines = [
    '## Developer Space proposal (not applied)',
    `proposalId: ${proposal.id}`,
    `status: ${proposal.status}`,
    `ops: ${proposal.ops.map((op) => op.op).join(', ')}`,
  ];
  if (proposal.summary) lines.push(`summary: ${proposal.summary}`);
  lines.push('', 'This draft is waiting for the user to approve. Do not claim the artifact changed.');
  return lines.join('\n');
}

export async function handleDevSpacePropose(
  ctx: SessionToolContext,
  args: DevSpaceProposeArgs,
): Promise<ToolResult> {
  const parsedOps = parseDevSpaceProposeOps(args?.ops);
  if ('error' in parsedOps) return errorResponse(`INVALID_ARGUMENT: ${parsedOps.error}`);

  const resolved = requireDevSpaceRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;
  if (typeof runtime.propose !== 'function') {
    return errorResponse(
      'CAPABILITY_DISABLED: devspace_propose is unavailable — the dev-space runtime has no propose seam. Reads still work.',
    );
  }
  const scope = devSpaceRuntimeScope(ctx);
  if (!scope.workspaceRoot) {
    return errorResponse('DEVSPACE_UNAVAILABLE: session has no workspace root to resolve artifacts against.');
  }

  const input: DevSpaceProposeInput = {
    ops: parsedOps,
    ...(typeof args.summary === 'string' && args.summary.trim() ? { summary: args.summary.trim() } : {}),
    ...(typeof args.projectSlug === 'string' && args.projectSlug ? { projectSlug: args.projectSlug } : {}),
    ...(typeof args.repositoryId === 'string' && args.repositoryId ? { repositoryId: args.repositoryId } : {}),
    ...(typeof args.baseHash === 'string' && args.baseHash ? { baseHash: args.baseHash } : {}),
  };

  try {
    const proposal = await runtime.propose({ workspaceRoot: scope.workspaceRoot, input });
    return successResponse(formatProposal(proposal));
  } catch (error) {
    return devSpaceErrorResponse(error);
  }
}