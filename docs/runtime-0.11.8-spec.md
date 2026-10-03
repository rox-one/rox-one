# ROX runtime completion

Requested outcome: ship and install an updated native ROX release where every agent session uses OMP, normal sessions resume their saved transcript after process restart, branching works, context uses the ROX configuration directory, every prompt activates orchestrate/workflowz/ultrathink, and requested skill packs are bundled and discovered by actual OMP on a clean install.

Acceptance:
- Process restart resumes the same conversation, including tool turns; forks preserve their parent and cut at the selected message.
- Missing/corrupt transcripts fail explicitly or use an identified recovery path; never silently claim restored history.
- Context documents use resolveConfigDir(); legacy config/data migration preserves user edits and credentials.
- All desktop/session/task/auxiliary entry points route through OMP; incompatible legacy connections get deliberate migration or explicit diagnostics.
- Every OMP user prompt contains the three enabled native magic triggers without rewriting stored user text.
- Requested skills are mapped to real upstream sources, pinned with provenance and licenses, shipped offline, available in ROX and in the private public-model OMP profile. Ambiguous names are recorded with evidence rather than invented implementations.
- Regressions and native CLI discovery/branch/resume probes pass; remote macOS/Windows packages and public release assets verify; latest macOS app is installed and opens a working native UI.
- Craft product/runtime/package identifiers are migrated to ROX. Existing user data survives; third-party attribution remains accurate.

No user messages, secrets or unrelated dirty checkouts are modified. Apple signing remains dependent on supplied Developer ID credentials.
