# 002 — H3 in-process knowledge kernel (future)

Parent spec: [`docs/superpowers/specs/2026-08-20-white-label-knowledge-engine-design.md`](../../../docs/superpowers/specs/2026-08-20-white-label-knowledge-engine-design.md) §12.

**Status:** SCAFFOLDING (probe only). Agents must not merge kernel source, load a native addon, or claim in-process kernel works.

**Owner:** product + legal.

## Intent

After H1 (Rox window + hidden OEM kernel process) is shipping, Rox aims to **collapse the process boundary**: one process, one product, kernel not a separate program.

## Current binding

**H1 is the shipping host.** HTTP + process isolation. The Apache tree now has a **hosting-mode probe** (`resolveKnowledgeHosting`) that may report `'h3'` when `ROX_KNOWLEDGE_H3` is `1`/`true` **and** `oem-kernel/knowledge-engine.node` exists on disk. That flag is **not** an in-process kernel: the addon is never `require`d or imported in this slice. Reporting `'h3'` does not mean the kernel runs in-process.

## Forbidden (repeat until a dedicated ADR + legal sign-off)

- Importing OEM engine source into `apps/` or `packages/` of this Apache repo
- Opening kernel SQLite from Rox
- In-process FFI/Go calls instead of HTTP
- Shared database of sessions + blocks
- Loading / `require` of `knowledge-engine.node` (future ADR)

## Unlock

A future ADR must supersede suite-K ADR-001 and ADR-003 with legal sign-off. Until then this file records intent **and** the probe-only scaffold so the epic cannot vanish from `plans/next-program/decisions/`.
