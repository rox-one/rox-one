# OpenClaw → ROX port program

Traceability + working directory for the port of OpenClaw mechanisms into ROX.

- **Backlog**: `docs/openclaw-port/STATUS.md` (ledger; 96 rows seeded from the study matrix).
- **Study**: `port-analysis/` in `agisota/openclaw` @ `port-analysis/openclaw-features-2026-10-09`
  (12 evidence-backed area docs, 1,412-node knowledge graph, verification reports).
- **Branch**: `port/openclaw-features`, based on `origin/main` @ `7c2c202b7`.
- **Non-goals / rules**: see `HANDOFF-PROMPT.md` in the study and `AGENTS.md` in this repo.

## Working rules

1. Every slice names the ledger row(s) it implements; the ledger is updated in the same change.
2. Typed IPC only: new calls go through `CHANNEL_MAP` + `RPC_CHANNELS`, and every new channel is
   classified `LOCAL_ONLY` / `REMOTE_ELIGIBLE` (CI-enforced).
3. i18n: user-facing strings go through `t()`; new keys are staged in `docs/openclaw-port/i18n/`
   as `{ "<key>": { "en": ..., "ru": ..., ... } }` and merged into all 12 locales with
   `python3 docs/openclaw-port/tools/merge-i18n.py` before running `lint:i18n:*`.
4. No AI attribution in commits.
5. OpenClaw is MIT: reuse is legal; prefer clean-room re-expression and record provenance
   (matrix row + upstream path) in the ledger.