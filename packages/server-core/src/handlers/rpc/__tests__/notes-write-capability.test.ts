import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../../../..')

// Keep the filesystem module mock in a child so other handler tests retain
// their real access() implementation, including when run in the same suite.
const probe = String.raw`
const { mock } = await import('bun:test');
const assert = (await import('node:assert/strict')).default;
const { constants, realpathSync } = await import('node:fs');
const { join } = await import('node:path');
const fs = { ...await import('node:fs/promises') };
const { CodedError, RPC_CHANNELS } = await import('@rox/shared/protocol');
const root = realpathSync(process.env.ROX_WRITE_PROBE_ROOT);
const path = join(root, 'Readable.md');
const scenario = process.env.ROX_WRITE_PROBE_SCENARIO;
await fs.writeFile(path, '# Readable note');
let writeProbes = 0, bodyReads = 0;
const failure = scenario === 'coded'
  ? new CodedError('DOCUMENT_AUTHORITY_CHANGED', 'Controlled source authority failure')
  : Object.assign(new Error('Controlled access failure'), { code: scenario.replace('read-', ''), path });
mock.module('node:fs/promises', () => ({ ...fs, access: async (target, mode) => {
  if (String(target) === path && mode === constants.R_OK && scenario.startsWith('read-')) throw failure;
  if (String(target) === path && mode === constants.W_OK) {
    writeProbes++;
    if (scenario === 'ENOENT') await fs.rm(path);
    throw failure;
  }
  return fs.access(target, mode);
} }));
const { registerContentHandlers } = await import(process.env.ROX_WRITE_PROBE_REPO + '/packages/server-core/src/handlers/rpc/content.ts');
const handlers = new Map();
const content = registerContentHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, {
  notesRoot: () => root, ownsWindow: () => true, changed: () => {},
  readNote: async (_workspace, id) => {
    bodyReads++;
    return { id, title: id, path, content: await fs.readFile(path, 'utf8') };
  },
});
const context = { workspaceId: 'write-probe', clientId: 'fixture', webContentsId: 1 };
const ref = { workspaceId: 'write-probe', entityId: 'note:Readable' };
const read = () => content.readNote(context, 'write-probe', 'Readable');
if (['EROFS', 'EIO', 'EACCES', 'EPERM'].includes(scenario)) {
  assert.equal((await read()).content, '# Readable note');
  const resolved = await handlers.get(RPC_CHANNELS.content.RESOLVE)(context, ref);
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.content, '# Readable note');
  assert.equal(resolved.capabilities.read, true);
  assert.equal(resolved.capabilities.write, false);
  assert.equal(resolved.capabilities.adoptDescriptor, false);
  assert.ok(writeProbes > 0);
  assert.ok(bodyReads > 0);
} else {
  if (scenario === 'ENOENT') await assert.rejects(read, error => error instanceof CodedError && error.code === 'NOT_FOUND');
  else await assert.rejects(read, error => error === failure);
  assert.equal(bodyReads, 0);
  const resolved = await handlers.get(RPC_CHANNELS.content.RESOLVE)(context, ref);
  assert.equal(resolved.status, 'error');
  assert.equal(bodyReads, 0);
  assert.equal(writeProbes, scenario.startsWith('read-') ? 0 : scenario === 'ENOENT' ? 1 : 2);
}
console.log('verified-' + scenario);
`

test.each(['EROFS', 'EIO', 'EACCES', 'EPERM', 'ENOENT', 'coded', 'read-EACCES', 'read-EIO'])(
  'content reads preserve read authority when the access probe reports %s',
  scenario => {
    const root = mkdtempSync(join(tmpdir(), 'rox-note-write-capability-'))
    const config = join(root, 'config')
    mkdirSync(config)
    try {
      const result = Bun.spawnSync([process.execPath, '--eval', probe], {
        cwd: repoRoot,
        env: { ...process.env, ROX_CONFIG_DIR: config, CRAFT_CONFIG_DIR: config,
          ROX_WRITE_PROBE_ROOT: root, ROX_WRITE_PROBE_REPO: repoRoot, ROX_WRITE_PROBE_SCENARIO: scenario },
        stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
      })
      if (result.exitCode !== 0) throw new Error(result.stderr.toString())
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toContain(`verified-${scenario}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  },
  30_000,
)
