#!/usr/bin/env node
/**
 * Electron/Node characterization: bun:sqlite is not a Node builtin.
 * Full index-bench cannot run under node (extensionless TS specifiers).
 */
try {
  require('bun:sqlite')
  process.stdout.write(`${JSON.stringify({ runtime: 'node', bunSqlite: true })}\n`)
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  process.stdout.write(
    `${JSON.stringify({
      runtime: 'node',
      bunSqlite: false,
      code: /** @type {{ code?: string }} */ (err).code ?? null,
      message: err.message,
    })}\n`,
  )
  process.exitCode = 2
}
