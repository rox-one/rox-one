# Unified shell verdict

**Verdict:** `KEEP_EXPERIMENTAL`  
**Date:** 2026-10-10  
**Ticket:** `plans/next-program/tickets/11-shell-one-real-panel.md`

## Why

One real PanelHost panel is not enough to advertise a second product. The
unified shell stays behind `featureUnifiedShellAtom` (localStorage
`craft-feature-unified-shell`, **default OFF**). Classic AppShell is unchanged
when the flag is off.

Ticket 11 registered `knowledge.inspector` on slot `inspector`, gated by
`when: activeSurface=='knowledge' && unifiedShell`, so a knowledge surface tab
(including one restored from a layout snapshot) lists a real
`KnowledgeInspector` through PanelHost — not a stub. That is a single
contribution on a single slot.

The `unifiedShell` context key is injected by `PanelHost` from
`featureUnifiedShellAtom` and mirrors the `!unifiedShellEnabled` gate
`KnowledgeEntityPage` uses for its classic companion aside:

- flag OFF ⇒ PanelHost lists nothing on a knowledge surface; the classic aside
  (rendered by `KnowledgeEntityPage`) is the only knowledge inspector on
  screen — zero behavioral delta for the classic path;
- flag ON ⇒ PanelHost owns the single `knowledge.inspector` panel and
  `KnowledgeEntityPage` hides its classic aside.

## Missing contributions

- Browser/renderer verification: no browser-level check is available in this
  worktree, so the unified chrome beside classic AppShell is only covered by
  unit/source tests.

PanelHost slots still without core contributions:

- `activity`
- `navigator-primary`
- `navigator-secondary`
- `bottom`
- `status`

Registered in this ticket:

- `inspector` — `knowledge.inspector` (`when: activeSurface=='knowledge' && unifiedShell`)

InspectorHost `agent` / `outline` / `backlinks` sections remain stubs
(`INSPECTOR_LIVE_SECTIONS` is still `info` only). Those stubs are not PanelHost
contributions and do not change this verdict.

The default flag remains OFF; the UI does not advertise a second product.