import { mkdir, symlink, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const work = import.meta.dir;
const cwd = resolve(work, '..');
await mkdir(resolve(work, 'bun-only'), { recursive: true });
try { await symlink('/opt/homebrew/bin/bun', resolve(work, 'bun-only/bun')); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
}
const variants = process.argv.slice(2);
if (!variants.length || variants.some(item => !['baseline', 'mutation'].includes(item))) throw new Error('Choose baseline and/or mutation');
for (const variant of variants) {
  const sandbox = resolve(work, 'sandbox-' + variant);
  await mkdir(resolve(sandbox, 'tmp'), { recursive: true });
  await mkdir(resolve(sandbox, 'config'), { recursive: true });
  // Sequential task-owned resolver selection avoids Bun's tsconfig-override directory bug; source and tests stay identical.
  await Bun.write(resolve(work, 'tsconfig.json'), await readFile(resolve(work, variant + '.tsconfig.json')));
  const resolverSha256 = createHash('sha256').update(await readFile(resolve(work, 'tsconfig.json'))).digest('hex');
  const argv = ['/opt/homebrew/bin/bun', 'test', resolve(work, 'holdout.test.ts')];
  const env = { PATH: resolve(work, 'bun-only'), HOME: sandbox, TMPDIR: resolve(sandbox, 'tmp'), ROX_CONFIG_DIR: resolve(sandbox, 'config'), CRAFT_CONFIG_DIR: resolve(sandbox, 'config'), CRAFT_DEBUG: '0', CRAFT_PERF_RPC_TRACE: '0', HOLDOUT_VARIANT: variant, NO_COLOR: '1' };
  const startedAt = new Date().toISOString();
  const testSha256 = createHash('sha256').update(await readFile(resolve(work, 'holdout.test.ts'))).digest('hex');
  const child = Bun.spawn(argv, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const pid = child.pid;
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await Bun.write(resolve(work, variant + '.stdout.log'), stdout);
  await Bun.write(resolve(work, variant + '.stderr.log'), stderr);
  await Bun.write(resolve(work, variant + '.execution.json'), JSON.stringify({ variant, argv, cwd, environment: env, pid, startedAt, finishedAt: new Date().toISOString(), exitCode, testSha256, resolverSha256,
    stdoutSha256: createHash('sha256').update(stdout).digest('hex'), stderrSha256: createHash('sha256').update(stderr).digest('hex') }, null, 2));
  console.log(JSON.stringify({ variant, pid, exitCode, testSha256 }));
  console.log(stdout + stderr);
}
await Bun.write(resolve(work, 'tsconfig.json'), await readFile(resolve(work, 'baseline.tsconfig.json')));
