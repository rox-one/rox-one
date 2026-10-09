/**
 * W1-12 (#1509) — server-core rules module: the local domain-rule consumer.
 *
 * - `engine.ts` — the authority-independent algorithm (TECH-SPEC §14.2);
 * - `host.ts` — the local ports (agent, p2p chat, settings);
 * - `consumer.ts` — the in-process subscriber (flag-gated, inert when off);
 * - `command-module.ts` — the automation command bindings (daily note, system
 *   list, invite email) registered through `COMMAND_MODULES`.
 */

export * from './store.ts'
export * from './engine.ts'
export * from './host.ts'
export * from './consumer.ts'
export * from './settings.ts'
export * from './command-module.ts'
export * from './wiring.ts'