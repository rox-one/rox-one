/** Build production renderer before measuring paint; provider/server remain test-only. */
const vite = ['run', 'node_modules/vite/bin/vite.js']
const config = ['--config', 'tests/e2e/runtime-map/vite.config.ts']
const build = Bun.spawn([process.execPath, ...vite, 'build', ...config], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=4096' } })
const buildExit = await build.exited
if (buildExit !== 0) process.exit(buildExit)
const preview = Bun.spawn([process.execPath, ...vite, 'preview', ...config, '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, NODE_ENV: 'production' } })
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => preview.kill(signal))
process.exit(await preview.exited)
