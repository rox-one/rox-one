# 001 — G2 managed SiYuan: stay A

Ticket 14. Parent record: [`docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md`](../../../docs/specs/2026-08-07-siyuan-integration/g2-decision-record.md).

**Status:** OPEN — blocked on legal/commercial. This ADR does **not** accept B or C.

**Owner:** product + legal (pzd). An agent must not flip this.

## Context

Suite K needs a written choice before a managed SiYuan kernel can ship:

1. **C (OEM)** — commercial/OEM permission from the SiYuan rightsholder.
2. **B (AGPL-compatible open product)** — publish the combined volume under AGPL-compatible terms.
3. **A (external-local)** — user installs SiYuan; Rox talks HTTP API only.

## Current binding (production)

**A (external-local) only.**

- No SiYuan source or binary in this monorepo or installer.
- No managed spawn that ships or downloads a kernel.
- Runtime `mode: 'managed'` is fail-closed (`CAPABILITY_DISABLED` / `engineStatus.running: false` + reason citing G2).
- Detection assist (`knowledge:detectEngine`) probes install paths + `127.0.0.1:6806` and links to official install docs — never downloads.

## Considered options (not chosen)

- **Accept B** — rejected until a human writes a source-offer + NOTICE process and channel compatibility (parent record, § acceptance).
- **Accept C** — rejected until signed OEM/commercial terms cover the versions/platforms needed for managed.

## What would flip this

Written legal/commercial decision choosing B or C (or an explicit permanent stay on A), then `Status: ACCEPTED` on the parent G2 record. Until then, **P7 managed does not start.**
