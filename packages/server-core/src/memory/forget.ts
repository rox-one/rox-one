/**
 * forget — explicit memory forget + lineage retention (spec c1.8).
 *
 * Forgetting a chunk id removes the content from EVERY surface it can be read
 * from, atomically from the reader's perspective:
 *   1. the corpus line/block in the workspace document (`memory/context.md`,
 *      `memory/history/<day>.md`, `memory/lessons.jsonl`, `projects/<slug>/MEMORY.md`) —
 *      atomic tmp+rename rewrite per file,
 *   2. the chunk index — rebuilt from the rewritten files, so `memory_search`
 *      can no longer return it,
 *   3. embedding artifacts — cached episode embeddings whose id or exact text
 *      matches the forgotten content are dropped.
 * Because every step is synchronous, a reader on the same thread never observes
 * an intermediate state; and the index is rebuilt before the call returns.
 *
 * A lineage record is then appended through the workspace {@link AuditLog}: what
 * was forgotten (chunk id + path), when, why and by whom. The record stores only
 * a SHA-1 of the removed text — it is auditable but never retrievable as memory
 * and never re-injected (audit.jsonl is not an indexed memory source). Forgetting
 * an already-forgotten id resolves to nothing and is a clean no-op that writes no
 * lineage record.
 *
 * Clean-room re-expression of OpenClaw's month-2 origin deletion
 * (extensions/memory-core/src/memory-entry-origins.ts:120): forget deletes
 * tracked origins + session-corpus lines + index chunks + embeddings and records
 * the forgotten sessions; ROX keeps the same "delete content, retain an
 * auditable lineage" split over its file + chunk-index corpus.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import type {
  AuditActor,
  MemoryForgetEntry,
  MemoryForgetLineage,
  MemoryForgetResult,
} from '@rox/shared/memory/types'
import type { AuditLog } from './AuditLog'
import type { EpisodicMemory } from './episodic-memory'
import type { MemoryIndexService } from './MemoryIndexService'

export interface ForgetMemoryInput {
  /** Workspace chunk index (also the resolver for chunk ids → path/text). */
  index: MemoryIndexService
  workspaceRoot: string
  /** Workspace audit log — the queryable lineage surface. */
  audit: AuditLog
  /** Chunk ids to forget (e.g. from memory_search hits). */
  ids: readonly string[]
  by: AuditActor
  reason?: string
  now?: Date
  /** Episodic store holding cached embeddings; purged for forgotten content. */
  episodic?: EpisodicMemory
}

/** Remove one exact line block from a document, or null when it is absent. */
function withoutBlock(content: string, text: string): string | null {
  if (!text) return null
  const lines = content.split('\n')
  const block = text.split('\n')
  for (let i = 0; i + block.length <= lines.length; i++) {
    if (lines.slice(i, i + block.length).join('\n') !== text) continue
    lines.splice(i, block.length)
    // Collapse the doubled blank line the removal may leave behind.
    if (lines[i] === '' && (lines[i - 1] === '' || i === 0)) lines.splice(i, 1)
    return lines.join('\n')
  }
  return null
}

/**
 * Remove a lesson line from `lessons.jsonl`. A lesson chunk's text is the rule
 * value, not the whole JSON line, so the removal is keyed on the parsed `rule`
 * (also honoring lessons keyed without JSON formatting).
 */
function withoutLessonLine(content: string, text: string): string | null {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.trim() === '') continue
    let rule: string | null = null
    try {
      const parsed = JSON.parse(line) as { rule?: unknown }
      if (typeof parsed.rule === 'string') rule = parsed.rule
    } catch {
      rule = null
    }
    if (rule === null ? line === text : rule === text) {
      lines.splice(i, 1)
      return lines.join('\n')
    }
  }
  return null
}

function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

/**
 * Forget the given chunk ids for one workspace. Never throws on a missing id or
 * an unreadable document (that is the "already forgotten" no-op); returns the
 * exact set of ids removed and the lineage record written.
 */
export function forgetMemoryChunks(input: ForgetMemoryInput): MemoryForgetResult {
  const ids = [...new Set(input.ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))]
  const resolved: Array<{ chunkId: string; path: string; text: string }> = []
  const alreadyForgotten: string[] = []
  for (const id of ids) {
    const chunk = input.index.get(id)
    if (chunk) resolved.push({ chunkId: id, path: chunk.path, text: chunk.text })
    else alreadyForgotten.push(id)
  }
  if (resolved.length === 0) {
    return { forgotten: [], alreadyForgotten, lineage: null }
  }

  // Group by document so each file is rewritten once (deterministic order).
  const byFile = new Map<string, Array<{ chunkId: string; text: string }>>()
  for (const r of resolved) {
    const list = byFile.get(r.path)
    if (list) list.push({ chunkId: r.chunkId, text: r.text })
    else byFile.set(r.path, [{ chunkId: r.chunkId, text: r.text }])
  }

  const entries: MemoryForgetEntry[] = []
  const texts = new Set<string>()
  for (const [relPath, chunks] of [...byFile.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const abs = join(input.workspaceRoot, relPath)
    let content: string
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      // Document already gone — nothing to rewrite on disk; still forgotten.
      for (const c of chunks) {
        entries.push({ chunkId: c.chunkId, path: relPath, textHash: sha1(c.text) })
        texts.add(c.text)
      }
      continue
    }
    let changed = false
    for (const c of chunks) {
      const next = relPath.endsWith('.jsonl') ? withoutLessonLine(content, c.text) : withoutBlock(content, c.text)
      if (next !== null) {
        content = next
        changed = true
      }
      entries.push({ chunkId: c.chunkId, path: relPath, textHash: sha1(c.text) })
      texts.add(c.text)
    }
    if (changed) atomicWriteFileSync(abs, content, { durable: true })
  }

  // 2. Index: rebuild from the rewritten corpus so search can no longer return
  //    the forgotten chunks (also folds in any external staleness).
  try {
    input.index.rebuild()
  } catch {
    // A failed rebuild is not fatal: the file change makes the index stale, so
    // the next search rebuilds before returning hits.
  }

  // 3. Embedding artifacts tied to the forgotten ids/texts.
  input.episodic?.forget({ ids: new Set(ids), texts })

  // 4. Lineage: content-free (hashes only), append-only, never injected.
  const lineage: MemoryForgetLineage = {
    ts: (input.now ?? new Date()).toISOString(),
    actor: input.by,
    ids: entries.map((e) => e.chunkId),
    reason: input.reason ?? '',
    entries,
  }
  try {
    input.audit.append({
      actor: input.by,
      action: 'forget',
      target: lineage.ids.join(','),
      detail: JSON.stringify({ reason: lineage.reason, entries }),
    })
  } catch {
    // Auditing is best-effort; the content removal already landed.
  }

  return { forgotten: lineage.ids, alreadyForgotten, lineage }
}