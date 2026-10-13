#!/usr/bin/env node
// Bun 1.4.x can skip the Electron postinstall even when `electron` is in
// trustedDependencies, leaving node_modules/electron/dist empty. Re-run the
// vendor installer when the binary is missing so `bun install && bun run
// electron:dev` works from a clean clone.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
let electronDir
try {
  electronDir = dirname(require.resolve('electron/package.json'))
} catch {
  process.exit(0)
}
const installJs = join(electronDir, 'install.js')
const dist = join(electronDir, 'dist')
const hasBinary = existsSync(join(dist, 'Electron.app'))
  || existsSync(join(dist, 'electron'))
  || existsSync(join(dist, 'electron.exe'))
if (!existsSync(installJs) || hasBinary) process.exit(0)
const result = spawnSync(process.execPath, [installJs], { stdio: 'inherit', cwd: root })
process.exit(result.status ?? 1)
