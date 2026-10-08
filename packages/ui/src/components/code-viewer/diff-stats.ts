/**
 * Pure diff parsing/stat helpers (no Shiki, no @pierre/diffs renderer).
 *
 * TurnCard and the diff overlay header need these at startup; keeping them out
 * of ShikiDiffViewer/UnifiedDiffViewer lets those viewers (and Shiki, which
 * they pull in) load only when a diff is actually shown (PERF-04).
 */
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

/**
 * Calculate addition/deletion stats from a FileDiffMetadata
 * Useful for displaying change counts in headers
 */
export function getDiffStats(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionCount
    deletions += hunk.deletionCount
  }
  return { additions, deletions }
}

/**
 * Parse a unified diff string into FileDiffMetadata.
 * Handles edge cases like empty diffs or malformed patches.
 */
export function parseUnifiedDiff(unifiedDiff: string, filePath: string): FileDiffMetadata | null {
  if (!unifiedDiff || !unifiedDiff.trim()) {
    return null
  }

  try {
    // parsePatchFiles expects a complete patch format
    // If the diff doesn't have a proper header, we might need to add one
    let patchContent = unifiedDiff

    // Check if it's a raw hunk without file headers
    // A proper unified diff starts with "---" or "diff --git"
    if (!patchContent.startsWith('---') && !patchContent.startsWith('diff ')) {
      // Wrap in minimal unified diff format
      patchContent = `--- a/${filePath}\n+++ b/${filePath}\n${patchContent}`
    }

    const patches = parsePatchFiles(patchContent)
    const firstPatch = patches[0]
    if (firstPatch && firstPatch.files.length > 0) {
      const firstFile = firstPatch.files[0]
      return firstFile ?? null
    }
    return null
  } catch (e) {
    console.warn('[UnifiedDiffViewer] Failed to parse unified diff:', e)
    return null
  }
}

/**
 * Calculate addition/deletion stats from a unified diff string.
 * Useful for displaying change counts in headers without full rendering.
 */
export function getUnifiedDiffStats(unifiedDiff: string, filePath: string = 'file'): { additions: number; deletions: number } | null {
  const fileDiff = parseUnifiedDiff(unifiedDiff, filePath)
  if (!fileDiff) return null

  let additions = 0
  let deletions = 0
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionCount
    deletions += hunk.deletionCount
  }
  return { additions, deletions }
}
