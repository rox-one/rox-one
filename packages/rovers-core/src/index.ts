/**
 * @rox/rovers-core — Rovers runtime core (M1).
 *
 * Surface:
 *   • errors.ts              — the 14 frozen failure codes (`spec.md` §5.5)
 *   • types.ts               — engine config + container client contracts
 *   • config/engine.ts       — `<configDir>/rovers/engine.json` (M1-B2)
 *   • engines/local/lima.ts  — local Lima engine spawn, engine-owned cache (M1-B2)
 *   • engines/local/container-client.ts — Docker Engine API client (M1-B4)
 *   • security/gate.ts       — container-socket authorization gate (M1-B5)
 */

export * from './errors.ts'
export * from './types.ts'
export * from './config/engine.ts'
export * from './engines/local/lima.ts'
export * from './engines/local/container-client.ts'
export * from './security/gate.ts'
