import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { OMP_NATIVE_AGENT_SOURCE_SHA256 } from '../omp-native-policy.ts';
import { createFakeOmp, useFakeOmpEnv, type FakeOmp } from './omp-fake-cli.ts';

// Optional native integration fixture: use only cached package SOURCE, never
// launch the installed CLI or read its auth/config. CI can supply this path.
const packageDir = process.env.ROX_OMP_PACKAGE_DIR ?? join(homedir(), '.rox', 'toolchain', 'omp', 'current', 'package');
const sourcePath = join(packageDir, 'src', 'session', 'agent-session.ts');
export const hasNativeSource = existsSync(sourcePath)
  && createHash('sha256').update(readFileSync(sourcePath)).digest('hex') === OMP_NATIVE_AGENT_SOURCE_SHA256;
if (process.env.ROX_OMP_PACKAGE_DIR && !hasNativeSource) throw new Error('Configured native fixture source does not match the pinned integrity');

export function createNativeLaunchFixture(): { fake: FakeOmp; restore(): void; packageDir: string; observation: string } {
  const source = readFileSync(sourcePath, 'utf8');
  const fake = createFakeOmp('model-public');
  const root = join(fake.workspaceRoot, 'managed runtime with spaces');
  const pkg = join(root, 'package');
  mkdirSync(join(pkg, 'src', 'session'), { recursive: true });
  mkdirSync(join(pkg, 'node_modules'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version: '18.4.12', type: 'commonjs', bin: { omp: 'original.cjs' } }));
  writeFileSync(join(pkg, 'src', 'session', 'agent-session.ts'), source);
  writeFileSync(join(pkg, 'original.cjs'), 'throw new Error("Original package CLI must not bypass native policy")');
  const observation = join(fake.dir, 'native-launch.jsonl');
  writeFileSync(join(pkg, 'src', 'cli.ts'), `
require('node:fs').appendFileSync(${JSON.stringify(observation)}, JSON.stringify({
  entry: __filename, argv: process.argv.slice(2), profile: process.env.PI_CODING_AGENT_DIR,
  attribution: process.env.OMP_APP_NAME,
}) + '\\n');
` + readFileSync(join(fake.dir, 'fake-omp.js'), 'utf8'));
  fake.binPath = join(root, 'bin', process.platform === 'win32' ? 'rox.cmd' : 'rox');
  writeFileSync(fake.binPath, '@echo off\r\nexit /b 99\r\n');

  const keys = ['HOME', 'USERPROFILE', 'CRAFT_BUNDLED_ASSETS_ROOT'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  process.env.HOME = fake.dir;
  process.env.USERPROFILE = fake.dir;
  process.env.CRAFT_BUNDLED_ASSETS_ROOT = join(fake.dir, 'empty-assets');
  const restoreFake = useFakeOmpEnv(fake);
  return { fake, packageDir: pkg, observation, restore() {
    restoreFake();
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  } };
}

export async function cleanupNativeLaunchFixture(fake: FakeOmp): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { fake.cleanup(); return; }
    catch (error) {
      if (attempt >= 40 || !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
