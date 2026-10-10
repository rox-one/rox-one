/**
 * Rovers Slice A (info-only curated catalog) — cross-backend wiring guard.
 *
 * Proves the rovers_* session tools reach every agent backend through the one
 * shared builder (`buildSessionToolDefs`) and are allowed in Explore/Safe mode
 * via the canonical session-tools-core metadata (mode-manager derives the
 * safe-mode allow-list from `getSessionSafeAllowedToolNames`, so no separate
 * allow-list edit is needed — this test locks that derivation in).
 */

import { describe, expect, it } from 'bun:test'

import { shouldAllowToolInMode } from '../mode-manager.ts'
import { buildSessionToolDefs } from '../session-tool-defs.ts'

const ROVERS_TOOLS = ['mcp__session__rovers_list', 'mcp__session__rovers_search', 'mcp__session__rovers_show']

describe('buildSessionToolDefs — Rovers catalog tools', () => {
  it('advertises rovers_list / rovers_search / rovers_show to every backend', () => {
    const names = buildSessionToolDefs().map((def) => def.name)
    for (const tool of ROVERS_TOOLS) expect(names).toContain(tool)
  })

  it('keeps them advertised when pool proxies are included (OMP single-frame)', () => {
    const names = buildSessionToolDefs({ includePoolProxyDefs: true }).map((def) => def.name)
    for (const tool of ROVERS_TOOLS) expect(names).toContain(tool)
  })
})

describe('mode-manager — Rovers tools are Explore-safe', () => {
  it('allows all three rovers tools in safe mode', () => {
    for (const tool of ROVERS_TOOLS) {
      expect(shouldAllowToolInMode(tool, {}, 'safe').allowed).toBe(true)
    }
  })
})