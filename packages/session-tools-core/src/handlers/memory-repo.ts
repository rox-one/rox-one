/**
 * memory_repo_read / memory_repo_search — read-only access to the memory
 * repository (the deterministic git projection built by `MemoryRepoService`,
 * Wave A §7 of docs/plans/2026-10-09-memory-repository-and-dreaming.md).
 *
 * Both tools are thin facades over the registered MemoryRepoToolRuntime — the
 * same service the `memory:repo*` RPC channels serve. Bounded (read bodies are
 * capped like KNOWLEDGE_READ_MAX_MARKDOWN_CHARS; search hits have a hard limit),
 * deterministic (search matches over shell-glob-safe sorted paths), and typed
 * (a missing runtime/bank is a clear error response, never a throw). Banks are
 * scoped to the session's own workspace plus the local `main` bank, so a session
 * bound to workspace A cannot enumerate or read workspace B's bank.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';
import {
  getMemoryRepoToolRuntime,
  type MemoryRepoBankRef,
  type MemoryRepoFileView,
  type MemoryRepoToolRuntime,
} from '../memory-repo/runtime.ts';
import type { MemoryRepoReadArgs, MemoryRepoSearchArgs } from '../tool-defs.ts';

/** Repository file body cap — mirrors KNOWLEDGE_READ_MAX_MARKDOWN_CHARS. */
export const MEMORY_REPO_READ_MAX_CHARS = 32_000;
/** Hard cap on requested search hits — the tool description advertises 20/default, 50/max. */
export const MEMORY_REPO_SEARCH_MAX_LIMIT = 50;
const MEMORY_REPO_SEARCH_DEFAULT_LIMIT = 20;
const MAX_SNIPPET_CHARS = 300;
/** Default bank when the caller does not pin one. */
const DEFAULT_BANK_ID = 'main';

/** Codepoint comparator — locale-independent, so hit order is deterministic across hosts. */
function comparePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function requireMemoryRepoRuntime():
  | { ok: true; runtime: MemoryRepoToolRuntime }
  | { ok: false; response: ToolResult } {
  const runtime = getMemoryRepoToolRuntime();
  if (!runtime) {
    return {
      ok: false,
      response: errorResponse(
        'MEMORY_REPO_UNAVAILABLE: Memory repository tools are unavailable in this process — no ' +
          'memory-repo runtime is registered. They run where the memory:repo RPC layer runs ' +
          '(the main server); they are not available in this session backend.',
      ),
    };
  }
  return { ok: true, runtime };
}

/** Wrap any non-typed failure from the runtime so nothing raw crosses the tool boundary. */
function memoryRepoErrorResponse(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return errorResponse(`MEMORY_REPO_ERROR: ${message}`);
}

/**
 * Resolve the requested bank against the bank list: an explicit `bank` must
 * exist; otherwise the main bank is the default. A missing bank is a clear
 * typed error, not an empty result.
 *
 * Session tools run as the local user, so the visible bank set is restricted to
 * the session's own workspace bank plus the local `main` bank: a session bound
 * to workspace A must not enumerate or read workspace B's bank.
 */
async function resolveBank(
  runtime: MemoryRepoToolRuntime,
  bankArg: string | undefined,
  sessionWorkspacePath: string,
): Promise<{ ok: true; bank: MemoryRepoBankRef } | { ok: false; response: ToolResult }> {
  const all = await runtime.listBanks();
  const workspaceId = runtime.resolveWorkspaceId(sessionWorkspacePath);
  const ownBankId = workspaceId ? `ws:${workspaceId}` : null;
  const banks = all.filter(
    (bank) => bank.isMain || bank.id === DEFAULT_BANK_ID || (ownBankId !== null && bank.id === ownBankId),
  );
  if (typeof bankArg === 'string' && bankArg.trim()) {
    const requested = bankArg.trim();
    const match = banks.find((bank) => bank.id === requested);
    if (!match) {
      return {
        ok: false,
        response: errorResponse(
          `MEMORY_REPO_BANK_NOT_FOUND: no memory bank "${requested}". Available banks: ${
            banks.length > 0 ? banks.map((bank) => bank.id).join(', ') : '(none)'
          }`,
        ),
      };
    }
    return { ok: true, bank: match };
  }
  const main = banks.find((bank) => bank.isMain) ?? banks.find((bank) => bank.id === DEFAULT_BANK_ID) ?? banks[0];
  if (!main) {
    return {
      ok: false,
      response: errorResponse(
        'MEMORY_REPO_BANK_NOT_FOUND: no memory repository banks are available. ' +
          'Pass "bank" explicitly, or materialize the repository first.',
      ),
    };
  }
  return { ok: true, bank: main };
}

/** First repository file whose frontmatter lesson id matches, in deterministic path order. */
async function resolvePathByLessonId(
  runtime: MemoryRepoToolRuntime,
  bankId: string,
  lessonId: string,
): Promise<string | null> {
  const files = (await runtime.tree(bankId))
    .filter((node) => node.type === 'file')
    .map((node) => node.path)
    .sort(comparePaths);
  for (const path of files) {
    try {
      const file = await runtime.readFile(bankId, path);
      if (file.lessonId === lessonId) return path;
    } catch {
      // An unreadable file simply does not carry the lesson.
    }
  }
  return null;
}

function formatRead(shownBank: string, file: MemoryRepoFileView): string {
  const truncatedByUs = file.content.length > MEMORY_REPO_READ_MAX_CHARS;
  const body = truncatedByUs ? file.content.slice(0, MEMORY_REPO_READ_MAX_CHARS) : file.content;
  const lines = [
    `## Memory repository file: ${file.path}`,
    `_bank: ${shownBank}_`,
    `path: ${file.path}`,
  ];
  if (file.lessonId) lines.push(`lessonId: ${file.lessonId}`);
  if (file.edited) lines.push('edited: true (human-modified, not yet overwritten by the projection)');
  lines.push('', '---', '', body);
  if (truncatedByUs) {
    lines.push(`\n_[content truncated at ${MEMORY_REPO_READ_MAX_CHARS} characters]_`);
  } else if (file.truncated) {
    lines.push('\n_[content truncated by the repository service]_');
  }
  return lines.join('\n');
}

export async function handleMemoryRepoRead(
  ctx: SessionToolContext,
  args: MemoryRepoReadArgs,
): Promise<ToolResult> {
  const path = typeof args?.path === 'string' && args.path.trim() ? args.path.trim() : undefined;
  const lessonId = typeof args?.lessonId === 'string' && args.lessonId.trim() ? args.lessonId.trim() : undefined;
  if (!path && !lessonId) {
    return errorResponse('INVALID_ARGS: memory_repo_read requires either "path" or "lessonId".');
  }

  const resolved = requireMemoryRepoRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;

  try {
    const bankResolved = await resolveBank(runtime, args?.bank, ctx.workspacePath);
    if (!bankResolved.ok) return bankResolved.response;
    const bank = bankResolved.bank;

    let targetPath = path;
    if (!targetPath && lessonId) {
      targetPath = (await resolvePathByLessonId(runtime, bank.id, lessonId)) ?? undefined;
      if (!targetPath) {
        return errorResponse(
          `NOT_FOUND: no repository file in bank "${bank.id}" carries lessonId "${lessonId}".`,
        );
      }
    }

    const file = await runtime.readFile(bank.id, targetPath!);
    return successResponse(formatRead(bank.id, file));
  } catch (error) {
    return memoryRepoErrorResponse(error);
  }
}

/** Lines containing any token win the snippet; otherwise the first content line. */
function snippetFor(content: string, tokens: string[]): string {
  const lines = content.split('\n');
  const match =
    lines.find((line) => tokens.some((token) => line.toLowerCase().includes(token))) ??
    lines.find((line) => line.trim().length > 0) ??
    '';
  const snippet = match.trim().replace(/\s+/g, ' ');
  return snippet.length <= MAX_SNIPPET_CHARS ? snippet : `${snippet.slice(0, MAX_SNIPPET_CHARS)}…`;
}

export async function handleMemoryRepoSearch(
  ctx: SessionToolContext,
  args: MemoryRepoSearchArgs,
): Promise<ToolResult> {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return errorResponse('INVALID_ARGS: memory_repo_search requires a non-empty "query" string.');
  }
  // "substring/all-words": a single token is a plain substring; several tokens
  // must ALL appear (AND), case-insensitively, in the file path or its content.
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const requestedLimit =
    typeof args?.limit === 'number' && Number.isFinite(args.limit) ? args.limit : MEMORY_REPO_SEARCH_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), MEMORY_REPO_SEARCH_MAX_LIMIT);

  const resolved = requireMemoryRepoRuntime();
  if (!resolved.ok) return resolved.response;
  const { runtime } = resolved;

  try {
    const bankResolved = await resolveBank(runtime, args?.bank, ctx.workspacePath);
    if (!bankResolved.ok) return bankResolved.response;
    const bank = bankResolved.bank;

    const files = (await runtime.tree(bank.id))
      .filter((node) => node.type === 'file')
      .map((node) => node.path)
      .sort(comparePaths);

    type Hit = { path: string; lessonId?: string; snippet: string };
    const hits: Hit[] = [];
    let matched = 0;
    for (const filePath of files) {
      let file: MemoryRepoFileView;
      try {
        file = await runtime.readFile(bank.id, filePath);
      } catch {
        continue; // An unreadable file is simply absent from the search view.
      }
      const haystack = `${filePath}\n${file.content}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) continue;
      matched += 1;
      if (hits.length >= limit) continue; // still count matches past the cap for honest truncation
      hits.push({
        path: filePath,
        ...(file.lessonId ? { lessonId: file.lessonId } : {}),
        snippet: snippetFor(file.content, tokens),
      });
    }

    const header = [
      `## Memory repository search: "${query}"`,
      `_bank: ${bank.id}_`,
      matched === 0
        ? 'No matches.'
        : `${matched} match(es)` +
          (matched > hits.length ? `, first ${hits.length} shown (limit ${limit})` : `, showing ${hits.length}`),
    ].join('\n');

    const body = hits
      .map((hit, index) => {
        const lines = [`${index + 1}. \`${hit.path}\``, hit.lessonId ? `   lessonId: ${hit.lessonId}` : undefined, `   > ${hit.snippet}`];
        return lines.filter((line): line is string => line !== undefined).join('\n');
      })
      .join('\n\n');

    return successResponse(body ? `${header}\n\n${body}` : header);
  } catch (error) {
    return memoryRepoErrorResponse(error);
  }
}