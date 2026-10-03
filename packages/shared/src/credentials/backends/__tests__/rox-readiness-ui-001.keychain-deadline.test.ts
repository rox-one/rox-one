import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('a blocked system key provider has a bounded encrypted-file fallback that survives process restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ui001-keychain-deadline-'));
  const stalled = join(root, 'stalled');
  const unavailable = join(root, 'unavailable');
  const directory = join(root, 'store');
  const marker = join(root, 'provider-invocations');
  const restored = join(root, 'restart-result.json');
  const previousPath = process.env.PATH;
  for (const bin of [stalled, unavailable]) mkdirSync(bin);
  // Shield the real OS service even when running the negative control on macOS.
  for (const command of ['security', 'secret-tool']) {
    writeFileSync(join(stalled, command), '#!/bin/sh\nprintf "called\\n" >> "$UI001_KEYCHAIN_MARKER"\nexec /usr/bin/python3 -c "import time; time.sleep(12); raise SystemExit(1)"\n', { mode: 0o700 });
    writeFileSync(join(unavailable, command), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  }
  try {
    // Exercise the Node API used by Electron. Compile the real implementation;
    // the isolated CLI fixture is the only replaced OS boundary.
    const source = fileURLToPath(new URL('../secure-storage.ts', import.meta.url));
    const build = await Bun.build({ entrypoints: [source], outdir: join(root, 'bundle'), target: 'node', format: 'esm', naming: 'secure-storage.mjs' });
    expect(build.success).toBe(true);
    const modulePath = join(root, 'bundle', 'secure-storage.mjs');
    const observed = join(root, 'provider-result.json');
    const restartCode = `import { SecureStorageBackend } from ${JSON.stringify(modulePath)}; import { writeFileSync } from 'node:fs'; const value = await new SecureStorageBackend({directory: ${JSON.stringify(directory)}}).get({type:'anthropic_api_key'}); writeFileSync(${JSON.stringify(restored)}, JSON.stringify({pid:process.pid,value:value?.value}));`;
    const code = `import { SecureStorageBackend } from ${JSON.stringify(modulePath)}; import { writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; const began=performance.now(); await new SecureStorageBackend({directory:${JSON.stringify(directory)}}).set({type:'anthropic_api_key'},{value:'ui001-encrypted-fixture'}); const elapsed=performance.now()-began; const child=spawnSync(process.execPath,['--input-type=module','-e',${JSON.stringify(restartCode)}],{env:{...process.env,PATH:${JSON.stringify(`${unavailable}:${previousPath ?? '/usr/bin:/bin'}`)}},stdio:'ignore',timeout:5000}); writeFileSync(${JSON.stringify(observed)},JSON.stringify({pid:process.pid,elapsed,restartStatus:child.status}));`;
    const child = spawnSync('node', ['--input-type=module', '-e', code], { env: { ...process.env, PATH: `${stalled}:${previousPath ?? '/usr/bin:/bin'}`, UI001_KEYCHAIN_MARKER: marker }, stdio: 'ignore', timeout: 44000 });
    expect(child.status).toBe(0);
    const provider = JSON.parse(readFileSync(observed, 'utf8'));
    expect(provider.elapsed).toBeLessThan(11000);
    expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(3);
    expect(statSync(join(directory, 'credentials.key')).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, 'credentials.enc')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(directory, 'credentials.enc')).includes(Buffer.from('ui001-encrypted-fixture'))).toBe(false);
    expect(provider.restartStatus).toBe(0);
    const readback = JSON.parse(readFileSync(restored, 'utf8'));
    expect(readback.pid).not.toBe(provider.pid);
    expect(readback.value).toBe('ui001-encrypted-fixture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 45000);
