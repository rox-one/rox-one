# UI-001 current main verification

Request: fetch origin/main, avoid duplicating merged work, complete remaining gaps in a separate current-main branch, verify, and open a PR. Original UI-001.1/UI-001.2 Requirements, DoD, Full functional verification and Test method stay unchanged.

Initial fetched main: 57871f492d1b21177ab767454d90395d72496b4e. Final integrated main: bb047b946da41346301cffe88a43db0adf621dcf (#1470 changes task dates only; all 24 UI001 product hashes are identical). Product work is present through PRs1400,1420,1457,1468. PR1424 repairs credential metadata. This recheck initially found obsolete test expectations, missing test collaborators and an expired CI source manifest, rather than an unimplemented product repair.

Acceptance: retain red tests and CI failure, validate current canonical storage and session metadata ownership, preserve original browser assertions/timeouts, run with Bun 1.3.14 and frozen dependencies, pass the source binding gate with all 24 unchanged product inputs. Explicit fixture boundaries remain visible. Installed Windows 10/11, native macOS compositor/modal/DPI and actual hosted web remain original external acceptance: fullDoDClosed=false.

Authorized changes: isolated UI001 tests/fixtures and OWNER-UI-001 verification documents/source manifest. Retain product behavior and current native authority. Do not change other branches/worktrees or rox-release-20261003.
