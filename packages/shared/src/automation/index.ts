/**
 * W1-12 (#1509) — Automation rule contracts shared by the local consumer
 * (`packages/server-core/src/rules`) and the workspace `rules` consumer group
 * (`apps/workspace-service/src/modules/rules`).
 *
 * Types and constants come from `@rox/core/automation`; this module owns the
 * zod schemas of the settings API and of the new payloads.
 */

export * from './schemas.ts'