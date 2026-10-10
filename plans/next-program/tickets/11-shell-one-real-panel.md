# 11 — One real unified-shell panel

**What to build:** Either the Knowledge inspector (or Collection inspector) contributes a real panel through `PanelHost` in unified shell, verified beside classic shell, or the flag stays experimental and the UI does not advertise a second product.

**Blocked by:** 05 (already merged).

**Status:** done (KEEP_EXPERIMENTAL)

- [x] Classic shell path unchanged when the flag is off
- [x] Flag on: one panel shows real data, not a stub
- [x] Layout snapshot restores that panel
- [x] Written verdict: `ENABLE_DEFAULT` or `KEEP_EXPERIMENTAL` with the date and the missing contribution list

## Verdict

**KEEP_EXPERIMENTAL** — 2026-10-10. Canonical doc: `docs/unified-shell-verdict.md`.

- Panel: `knowledge.inspector` on slot `inspector`, `when:
  activeSurface=='knowledge' && unifiedShell`, rendered by
  `KnowledgeInspectorPanel` → real `KnowledgeInspector` (route-derived
  `KnowledgeRef`, live `useKnowledgeNode` data; no stub).
- Flag gating: `PanelHost` injects `unifiedShell` from
  `featureUnifiedShellAtom` into the when-context, mirroring
  `KnowledgeEntityPage`'s `!unifiedShellEnabled` classic-aside gate. Flag OFF ⇒
  PanelHost contributes nothing; the classic aside is the only inspector.
- Restore: `snapshotToUrlSearch → snapshotFromUrlSearch →
  snapshotToPanelEntries` keeps the knowledge tab, and its focused route makes
  the panel list (flag ON).
- Missing for a default: no browser-level verification of the unified chrome
  beside classic AppShell; `activity`, `navigator-primary`,
  `navigator-secondary`, `bottom`, `status` slots have no core contributions;
  InspectorHost `agent`/`outline`/`backlinks` sections remain stubs. Default
  flag stays OFF and the UI does not advertise a second product.