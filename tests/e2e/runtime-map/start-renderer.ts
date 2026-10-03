/** Build production renderer before measuring paint; provider/server remain test-only. */
import { resolve } from 'node:path'
const repoRoot = resolve(import.meta.dir, '../../..')
const vite = ['run', resolve(repoRoot, 'node_modules/vite/bin/vite.js')]
const config = ['--config', resolve(import.meta.dir, 'vite.config.ts')]
// Bound Tailwind's automatic source root to this test entrypoint. Production
// index.css keeps its explicit renderer/shared sources; raw evidence JSON is
// never an intended source of utility classes.
const build = Bun.spawn([process.execPath, ...vite, 'build', ...config], { cwd: import.meta.dir, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=4096' } })
const buildExit = await build.exited
if (buildExit !== 0) process.exit(buildExit)
const preview = Bun.spawn([process.execPath, ...vite, 'preview', ...config, '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { cwd: import.meta.dir, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => preview.kill(signal))
process.exit(await preview.exited)
