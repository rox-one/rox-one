/**
 * W1-12 (#1509) — Domain rule engine contracts (TECH-SPEC §14).
 *
 * Consumed by:
 * - `packages/server-core/src/rules/` — the local in-process consumer;
 * - `apps/workspace-service/src/modules/rules/` — the `rules` consumer group
 *   over `domain_event` plus the `automation_rule` settings API;
 * - package AUTO (#1529) — the full templates and follow-ups.
 */

export * from './rule.ts'
export * from './execution.ts'
export * from './events.ts'
export * from './ids.ts'
export * from './rules/index.ts'