import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../../../..')

// Child-only boundary mocks leave other tests' filesystem and home untouched.
// notifyFileChange still runs the real routing, debounce and skill loader.
const probe = String.raw`
const { mock } = await import('bun:test');
const assert = (await import('node:assert/strict')).default;
const fs = { ...await import('fs') };
const os = { ...await import('os') };
const asyncFs = { ...await import('fs/promises') };
const { join } = await import('path');
const root = fs.realpathSync(process.env.ROX_WATCHER_TEST_ROOT);
const workspace = join(root, 'workspace');
const file = join(workspace, 'skills', 'demo', 'SKILL.md');
const fallback = join(workspace, '.omp', 'skills', 'demo', 'SKILL.md');
const outsideDirectory = join(root, 'outside');
const outside = join(outsideDirectory, 'SKILL.md');
const scenario = process.env.ROX_WATCHER_TEST_SCENARIO;
const body = '# Healthy instructions';
const skillText = content => '---\nname: Demo\ndescription: Controlled fixture\n---\n' + content;
for (const path of [join(root, 'home'), outsideDirectory, join(workspace, 'skills', 'demo'), join(workspace, '.omp', 'skills', 'demo')]) fs.mkdirSync(path, { recursive: true });
fs.writeFileSync(fallback, skillText('# Lower-priority instructions'));
fs.writeFileSync(outside, skillText('# Escaping instructions'));
// Windows can create a directory junction without file-symlink privileges.
// Both probes reject the escaping canonical target before instructions reads.
if (scenario === 'escape') fs.symlinkSync(process.platform === 'win32' ? outsideDirectory : outside,
  file, process.platform === 'win32' ? 'junction' : 'file');
else fs.writeFileSync(file, skillText(body));
let denied = scenario === 'EACCES', bodyReads = 0;
const accessError = Object.assign(new Error('Controlled instructions access denied'), { code: 'EACCES' });
mock.module('os', () => ({ ...os, homedir: () => join(root, 'home') }));
mock.module('fs', () => ({ ...fs,
  watch: () => ({ close() {} }),
  realpathSync: path => {
    if (denied && String(path) === file) throw accessError;
    return fs.realpathSync(path);
  },
  readFileSync: (...args) => {
    if ([file, fallback, outside].includes(String(args[0]))) bodyReads++;
    return fs.readFileSync(...args);
  },
}));
mock.module('fs/promises', () => ({ ...asyncFs, readFile: (...args) => {
  if ([file, fallback, outside].includes(String(args[0]))) bodyReads++;
  return asyncFs.readFile(...args);
} }));
const { ConfigWatcher, _getActiveWatchers } = await import(process.env.ROX_WATCHER_TEST_REPO + '/packages/shared/src/config/watcher.ts');
const { loadSkillDetails } = await import(process.env.ROX_WATCHER_TEST_REPO + '/packages/shared/src/skills/storage.ts');
const errors = [], changes = [];
const watcher = new ConfigWatcher(workspace, {
  onError: (path, error) => errors.push({ path, error }),
  onSkillChange: (slug, skill) => changes.push({ slug, skill }),
});
const notify = () => { for (let i = 0; i < 3; i++) watcher.notifyFileChange('skills/demo/SKILL.md'); };
const waitFor = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(10);
  assert.ok(predicate(), 'Debounced callback did not arrive');
};
try {
  watcher.start();
  notify();
  await waitFor(() => errors.length > 0);
  await Bun.sleep(150);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'skills/demo');
  assert.equal(changes.length, 0);
  if (scenario === 'EACCES') assert.equal(errors[0].error, accessError);
  else assert.match(errors[0].error.message, /Skill instructions path denied/);
  await assert.rejects(() => loadSkillDetails(workspace, 'demo'), error =>
    scenario === 'EACCES' ? error === accessError : /Skill instructions path denied/.test(error.message));
  assert.equal(bodyReads, 0, 'Neither denied craft bytes nor lower-priority fallback may be read');
  if (scenario === 'escape') { fs.rmSync(file, { recursive: true }); fs.writeFileSync(file, skillText(body)); }
  denied = false;
  notify();
  await waitFor(() => changes.length > 0);
  await Bun.sleep(150);
  assert.equal(errors.length, 1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].slug, 'demo');
  assert.equal(changes[0].skill.content.trim(), body);
  assert.equal((await loadSkillDetails(workspace, 'demo')).content.trim(), body);
} finally { watcher.stop(); }
assert.equal(_getActiveWatchers().has(workspace), false);
console.log('verified-' + scenario);
`

test.each(['escape', 'EACCES'])('debounced skill %s reports once and allows a healthy reload', scenario => {
  const root = mkdtempSync(join(tmpdir(), 'rox-watcher-skill-errors-'))
  const config = join(root, 'config')
  mkdirSync(config)
  try {
    const result = Bun.spawnSync([process.execPath, '--eval', probe], {
      cwd: repoRoot,
      env: { ...process.env, ROX_CONFIG_DIR: config, CRAFT_CONFIG_DIR: config,
        ROX_WATCHER_TEST_ROOT: root, ROX_WATCHER_TEST_REPO: repoRoot, ROX_WATCHER_TEST_SCENARIO: scenario },
      stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`verified-${scenario}`)
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
