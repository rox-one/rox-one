/**
 * W1-10 (#1507) — migration fixtures.
 *
 * Golden inputs for MIG-01…MIG-12 (owned by W1-06 / #1503): v2 personal
 * tasks, okr.json, roadmap.json, a Dossier (localStorage) dump, and vault
 * notes covering every TipTap node type, including `[[kind:id|label]]`
 * and `![[kind:id]]` explicit link syntax. All data is synthetic.
 */
export * from './migrations.ts'
export * from './privacy.ts'
export * from './dock.ts'
