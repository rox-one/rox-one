# 01 — First-run credential step

**What to build:** A clean install either completes a first turn or stops on one screen that names the missing OMP/Rox credential and how to supply it. Retry after the credential is present succeeds without restarting the app.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Missing `~/.omp/agent/config.yml` surfaces as a single actionable step, not a generic chat error buried in the transcript
- [ ] After the user supplies a valid credential, the next send streams a model response
- [ ] Session is idle after the missing-credential failure (no spinner)
- [ ] Headless/CLI shows the same typed code the UI uses
