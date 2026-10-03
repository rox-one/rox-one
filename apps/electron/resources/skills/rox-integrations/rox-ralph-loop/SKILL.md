---
name: rox-ralph-loop
description: Apply a bounded verify-fix-repeat workflow inside an OMP session, or prepare the real upstream Ralph file-based loop when the user explicitly requests an external runner.
license: MIT
---

# Ralph loop integration for ROX

ROX-authored adapter. It does not install Claude Code stop hooks into OMP and does not claim native persistence beyond the running session. [Upstream Ralph](references/upstream-ralph.md) uses fresh agent processes and a PRD/progress-file workflow; the bundled ralph and prd skills describe its real artifacts.

For an OMP session: establish a concrete acceptance condition, record progress in the user's project, implement one bounded step, run the verifier, fix observed failures, and repeat until the acceptance condition passes or a concrete dependency requires the user. Keep permission boundaries and budget limits. Native OMP orchestrate/workflowz tools can delegate independent work; preserve the same acceptance and progress record.

If a persistent external loop is requested, inspect the upstream README and the installed runner first. Do not invoke a nonexistent `ralph-loop` command or assert Claude plugin hooks run in OMP. Starting an external agent is an explicit external-runner choice, not a change to the ROX session's OMP backend.
