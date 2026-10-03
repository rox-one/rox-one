import { expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('keeps vendored reports private and auth output free of credentials without network calls', () => {
  const root = resolve(import.meta.dir, '../../../../..');
  const output = execFileSync(process.env.ROX_TEST_PYTHON ?? 'python3', [
    resolve(import.meta.dir, 'vendor-security.py'), root,
  ], { cwd: root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  // Python unittest reports failures through a nonzero exit; no imported
  // upstream module, network endpoint or user's credential state is touched.
  expect(output).toBe('');
}, 30_000);
