# Unified shell verdict

**Verdict:** `KEEP_EXPERIMENTAL`  
**Date:** 2026-08-13

## Why

One real PanelHost panel is not enough to advertise a second product. The
unified shell stays behind `featureUnifiedShellAtom` (localStorage
`craft-feature-unified-shell`, **default OFF**). Classic AppShell is unchanged
when the flag is off.

Ticket 11 registered `knowledge.inspector` on slot `inspector` so a knowledge
surface tab (including one restored from a layout snapshot) lists a real
`KnowledgeInspector` through PanelHost — not a stub. That is a single
contribution on a single slot.

## Missing contributions

PanelHost slots still without core contributions:

- `activity`
- `navigator-primary`
- `navigator-secondary`
- `bottom`
- `status`

Registered in this ticket:

- `inspector` — `knowledge.inspector` (`when: activeSurface=='knowledge'`)

InspectorHost `agent` / `outline` / `backlinks` sections remain stubs
(`INSPECTOR_LIVE_SECTIONS` is still `info` only). Those stubs are not PanelHost
contributions and do not change this verdict.

The default flag remains OFF.
