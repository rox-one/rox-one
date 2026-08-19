# 002 — H3 in-process knowledge kernel (future)

Parent spec: [`docs/superpowers/specs/2026-08-20-white-label-knowledge-engine-design.md`](../../../docs/superpowers/specs/2026-08-20-white-label-knowledge-engine-design.md) §12.

**Status:** INTENT ONLY — not scheduled. Agents must not start H3 implementation.

**Owner:** product + legal.

## Intent

After H1 (Rox window + hidden OEM kernel process) is shipping, Rox aims to **collapse the process boundary**: one process, one product, kernel not a separate program.

## Current binding

**H1 only.** HTTP + process isolation. No kernel sources in this Apache tree. No SQLite open from Rox. No in-process FFI.

## Unlock

A future ADR must supersede suite-K ADR-001 and ADR-003 with legal sign-off. Until then this file exists so the intent cannot vanish from `plans/next-program/decisions/`.
