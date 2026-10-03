import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSubprocessProvider } from '../local-provider.ts';

test.skipIf(process.platform !== 'linux')('an actual unreaped Linux runner cannot keep a restored run queued', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rox-ui001-unreaped-runner-'));
  const pidPath = join(root, 'controlled-runner.pid');
  const node = Bun.which('node');
  expect(node).not.toBeNull();
  const childProgram = `
    const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {stdio:'ignore'});
    writeFileSync(process.argv[1], String(child.pid));
    // Prevent this controlled parent from reaping its exited child until cleanup.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000);
  `;
  const parent = Bun.spawn([node!, '-e', childProgram, pidPath], { stdout: 'ignore', stderr: 'inherit' });
  try {
    const by = Date.now() + 5000;
    let pid: number | null = null;
    let observedState = '';
    while (Date.now() < by) {
      const raw = await readFile(pidPath, 'utf8').catch(() => null);
      if (raw) {
        pid = Number(raw);
        const status = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
        observedState = status.slice(status.lastIndexOf(')') + 2, status.lastIndexOf(')') + 3);
        if (observedState === 'Z') break;
      }
      await Bun.sleep(10);
    }
    expect(observedState).toBe('Z');
    expect(() => process.kill(pid!, 0)).not.toThrow();
    const id = 'restored-unreaped-runner';
    const dir = join(root, id);
    await mkdir(dir);
    await writeFile(join(dir, 'state.json'), JSON.stringify({ id, state: 'queued' }));
    await writeFile(join(dir, 'runner.pid'), String(pid));
    await writeFile(join(dir, 'events.jsonl'), JSON.stringify({ type: 'state', status: { id, state: 'queued' } }) + '\n');
    const provider = new LocalSubprocessProvider({ baseDir: root });
    const failed = await provider.getStatus(id);
    expect(failed).toMatchObject({ id, state: 'failed', failureReason: 'runner_error' });
    expect(Number.isFinite(failed.finishedAt)).toBe(true);
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))).toEqual(failed);
    expect(await new LocalSubprocessProvider({ baseDir: root }).getStatus(id)).toEqual(failed);
    const events = (await readFile(join(dir, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'state', status: failed });
  } finally {
    parent.kill('SIGKILL');
    await parent.exited;
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);
