import { beforeEach, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ensureBundledSkills, listBundledSkillPacks } from '../../../../../shared/src/skills/bundled.ts';
import { APP_MANAGED_SKILLS_DIR, GLOBAL_AGENT_SKILLS_DIR, invalidateSkillsCache, loadAllSkills, loadSkillBySlug } from '../../../../../shared/src/skills/storage.ts';
import { invalidateOmpSkillsCache } from '../../../../../shared/src/skills/omp-discovery.ts';
import { isSkillLinkTo, linkManagedSkill, pathEntryExists } from '../../../../../shared/src/skills/managed.ts';
import { installEntry, removeEntry, sha256Directory, type ExecFileFn } from '../../../../../shared/src/marketplace/installer.ts';
import { marketplacePaths, type MarketplaceEntry } from '../../../../../shared/src/marketplace/catalog.ts';
import { readInstallMarker, readLock, removeInstallMarker } from '../../../../../shared/src/marketplace/lock.ts';
import { BaseAgent } from '../../../../../shared/src/agent/base-agent.ts';
import { RPC_CHANNELS } from '../../../../../shared/src/protocol/index.ts';
import { registerSkillsHandlers } from '../skills.ts';
import type { HandlerFn, RpcServer } from '@rox/server-core/transport';

const config = dirname(APP_MANAGED_SKILLS_DIR);
const bundle = join(homedir(), 'bundle');
const workspace = join(homedir(), 'workspace');
const ref = 'a'.repeat(40);
const md = (body: string) => `---\nname: Review\ndescription: A review skill\n---\n${body}\n`;
function put(path: string, content: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
function entry(id: string): MarketplaceEntry {
  return { id, kind: 'skillpack', title: id, descriptionRu: id, source: { type: 'github', repo: `fixtures/${id}`, ref } };
}
function git(contents: Record<string, string>): ExecFileFn {
  return async (_file, args, options) => {
    if (args.includes('checkout')) for (const [name, body] of Object.entries(contents)) put(join(options.cwd!, name, 'SKILL.md'), md(body));
    return { stdout: args[0] === 'rev-parse' ? ref : '', stderr: '' };
  };
}
beforeEach(() => {
  for (const path of [config, GLOBAL_AGENT_SKILLS_DIR, bundle, workspace, join(homedir(), 'external'), join(homedir(), 'blocked')]) rmSync(path, { recursive: true, force: true });
  mkdirSync(workspace, { recursive: true });
  invalidateSkillsCache(); invalidateOmpSkillsCache();
});

test('duplicate bundled packs and a user skill coexist; agent mentions and native file actions resolve each app path', async () => {
  put(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), md('USER'));
  put(join(bundle, 'pack-a', 'review', 'SKILL.md'), md('A'));
  put(join(bundle, 'pack-b', 'review', 'SKILL.md'), md('B'));
  const first = ensureBundledSkills({ bundleRoot: bundle });
  expect(first.targetRoot).toBe(APP_MANAGED_SKILLS_DIR);
  expect(first.packs.map(pack => pack.installed)).toEqual([['pack-a--review'], ['pack-b--review']]);
  const skills = loadAllSkills(workspace, undefined, { includeOmp: true, includeShadowedOmp: true });
  expect(skills.filter(skill => skill.source !== 'omp').map(skill => skill.slug).sort()).toEqual(['pack-a--review', 'pack-b--review', 'review']);
  expect(skills.filter(skill => skill.path.startsWith(APP_MANAGED_SKILLS_DIR))).toHaveLength(2);
  const extract = (BaseAgent.prototype as unknown as { extractSkillPaths(message: string): { skillPaths: Map<string, string>; missingSkills: string[] } }).extractSkillPaths;
  const activation = extract.call({ config: { workspace: { rootPath: workspace } }, workingDirectory: workspace, getSkillLoadOptions: () => ({}), debug() {} }, '[skill:pack-a--review] [skill:pack-b--review]');
  expect(activation.missingSkills).toEqual([]);
  expect([...activation.skillPaths.values()].sort()).toEqual(['pack-a--review', 'pack-b--review'].map(slug => join(APP_MANAGED_SKILLS_DIR, slug, 'SKILL.md')));
  expect(readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), 'utf8')).toBe(md('USER'));
  put(join(config, 'config.json'), JSON.stringify({ workspaces: [{ id: 'fixture', name: 'Fixture', rootPath: workspace, createdAt: 1 }] }));
  const handlers = new Map<string, HandlerFn>();
  const opened: string[] = [];
  registerSkillsHandlers({ handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler); } } as unknown as RpcServer, {
    platform: { openPath: async (path: string) => { opened.push(path); } },
  } as never);
  const ctx = { clientId: 'fixture', webContentsId: null, workspaceId: 'fixture' };
  const files = await handlers.get(RPC_CHANNELS.skills.GET_FILES)!(ctx, 'fixture', 'pack-a--review');
  expect(files).toContainEqual({ name: 'SKILL.md', type: 'file', size: Buffer.byteLength(md('A')) });
  await handlers.get(RPC_CHANNELS.skills.OPEN_EDITOR)!(ctx, 'fixture', 'pack-a--review');
  expect(opened).toEqual([join(APP_MANAGED_SKILLS_DIR, 'pack-a--review', 'SKILL.md')]);
  expect(await handlers.get(RPC_CHANNELS.skills.GET_FILES)!(ctx, 'fixture', '../external')).toEqual([]);
});

test('qualified aliases remain stable across restart, upgrades, owner removal and local edits', () => {
  put(join(bundle, 'pack-a', 'review', 'SKILL.md'), md('A1'));
  put(join(bundle, 'pack-b', 'review', 'SKILL.md'), md('B1'));
  ensureBundledSkills({ bundleRoot: bundle });
  const target = join(APP_MANAGED_SKILLS_DIR, 'pack-b--review');
  put(join(target, 'SKILL.md'), md('LOCAL'));
  put(join(bundle, 'pack-b', 'review', 'SKILL.md'), md('B2'));
  put(join(bundle, 'pack-b', 'review', 'notes.txt'), 'new asset');
  rmSync(join(bundle, 'pack-a', 'review'), { recursive: true });
  for (let n = 0; n < 3; n++) {
    const result = ensureBundledSkills({ bundleRoot: bundle });
    expect(result.packs[1]!.installed).toEqual(['pack-b--review']);
    expect(result.packs[1]!.localModified).toBe(true);
  }
  expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe(md('LOCAL'));
  expect(readFileSync(join(target, 'notes.txt'), 'utf8')).toBe('new asset');
  expect(listBundledSkillPacks({ bundleRoot: bundle })[1]!.installed).toEqual(['pack-b--review']);
});

test('disabling an app pack removes only its links and never hides a foreign skill with the same name', () => {
  put(join(bundle, 'pack-a', 'review', 'SKILL.md'), md('APP'));
  ensureBundledSkills({ bundleRoot: bundle });
  rmSync(join(GLOBAL_AGENT_SKILLS_DIR, 'review'));
  put(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), md('USER'));
  put(join(workspace, 'skills', 'review', 'SKILL.md'), md('WORKSPACE'));
  invalidateSkillsCache(); invalidateOmpSkillsCache();
  expect(loadAllSkills(workspace).map(skill => skill.slug).sort()).toEqual(['review', 'rox--review']);
  expect(loadSkillBySlug(workspace, 'rox--review')?.path).toBe(join(APP_MANAGED_SKILLS_DIR, 'review'));
  put(join(config, 'config.json'), JSON.stringify({ workspaces: [], bundledSkills: { disabled: ['pack-a'] } }));
  ensureBundledSkills({ bundleRoot: bundle });
  expect(loadAllSkills(workspace, undefined, { includeOmp: true, includeShadowedOmp: true }).filter(skill => skill.source !== 'omp').map(skill => skill.slug)).toEqual(['review']);
  expect(loadSkillBySlug(workspace, 'review')?.content).toContain('WORKSPACE');
  rmSync(join(workspace, 'skills'), { recursive: true }); invalidateSkillsCache();
  expect(loadSkillBySlug(workspace, 'review')?.content).toContain('USER');
  expect(existsSync(join(APP_MANAGED_SKILLS_DIR, 'review', 'SKILL.md'))).toBe(true);
});

test('a failed external link leaves app discovery functional and dangling foreign links untouched', () => {
  const blocked = join(homedir(), 'blocked'); put(blocked, 'not a directory');
  put(join(bundle, 'pack-a', 'review', 'SKILL.md'), md('APP'));
  const result = ensureBundledSkills({ bundleRoot: bundle, linksRoot: blocked });
  expect(result.packs[0]!.error).toBeUndefined();
  expect(loadAllSkills(workspace).map(skill => skill.slug)).toEqual(['review']);
  mkdirSync(GLOBAL_AGENT_SKILLS_DIR, { recursive: true });
  const dangling = join(GLOBAL_AGENT_SKILLS_DIR, 'review');
  symlinkSync(join(homedir(), 'missing'), dangling, 'dir');
  const link = linkManagedSkill(join(APP_MANAGED_SKILLS_DIR, 'review'), GLOBAL_AGENT_SKILLS_DIR, 'review');
  expect(lstatSync(dangling).isSymbolicLink()).toBe(true);
  expect(link).toBe(join(GLOBAL_AGENT_SKILLS_DIR, 'rox--review'));
  expect(isSkillLinkTo(link!, join(APP_MANAGED_SKILLS_DIR, 'review'))).toBe(true);
  expect(linkManagedSkill(join(APP_MANAGED_SKILLS_DIR, 'review'), GLOBAL_AGENT_SKILLS_DIR, 'review')).toBe(link);
});

test('marketplace defaults to the app store; aliases preserve pins, updates and uninstall ownership', async () => {
  put(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), md('USER'));
  const expected = join(homedir(), 'expected'); put(join(expected, 'SKILL.md'), md('PACK'));
  const pack = { ...entry('market-a'), expectedContentSha256: { review: sha256Directory(expected) } };
  const result = await installEntry(pack, { execFileFn: git({ review: 'PACK' }) });
  expect(result.kind === 'skillpack' && result.targets).toEqual([join(APP_MANAGED_SKILLS_DIR, 'market-a--review')]);
  expect(loadSkillBySlug(workspace, 'market-a--review')?.content).toContain('PACK');
  const repeated = await installEntry(pack, { execFileFn: git({ review: 'PACK' }) });
  expect(repeated.kind === 'skillpack' && repeated.skills).toEqual(['market-a--review']);
  expect(isSkillLinkTo(join(GLOBAL_AGENT_SKILLS_DIR, 'market-a--review'), join(APP_MANAGED_SKILLS_DIR, 'market-a--review'))).toBe(true);
  const removed = removeEntry('market-a');
  expect(removed.status).toBe('removed');
  expect(pathEntryExists(join(GLOBAL_AGENT_SKILLS_DIR, 'market-a--review'))).toBe(false);
  expect(readFileSync(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), 'utf8')).toBe(md('USER'));
  expect(loadSkillBySlug(workspace, 'market-a--review')).toBeNull();
});

test('updating a marketplace pack removes untouched dropped skills and preserves edited dropped skills', async () => {
  await installEntry(entry('market-a'), { execFileFn: git({ review: 'A', draft: 'D', retain: 'R' }) });
  put(join(APP_MANAGED_SKILLS_DIR, 'retain', '.personal'), 'USER');
  await installEntry(entry('market-a'), { execFileFn: git({ review: 'A2' }) });
  expect(existsSync(join(APP_MANAGED_SKILLS_DIR, 'draft'))).toBe(false);
  expect(pathEntryExists(join(GLOBAL_AGENT_SKILLS_DIR, 'draft'))).toBe(false);
  expect(readFileSync(join(APP_MANAGED_SKILLS_DIR, 'retain', '.personal'), 'utf8')).toBe('USER');
  expect(readLock(marketplacePaths(config).lockFile).entries['market-a']!.skills!.sort()).toEqual(['retain', 'review']);
  const removed = removeEntry('market-a');
  expect(removed.status).toBe('partial');
  expect(removed.kept).toEqual([{ path: join(APP_MANAGED_SKILLS_DIR, 'retain'), reason: 'locally-modified' }]);
  expect(pathEntryExists(join(GLOBAL_AGENT_SKILLS_DIR, 'retain'))).toBe(false);
});

test('unsafe names and checkout symlinks fail without reading or modifying external skill files', async () => {
  put(join(homedir(), 'external', 'SKILL.md'), md('EXTERNAL'));
  expect(loadSkillBySlug(workspace, '../external')).toBeNull();
  await expect(installEntry(entry('../../external'), { execFileFn: git({ review: 'PACK' }) })).rejects.toThrow('Invalid skill pack identity');
  const symlinkGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) {
      mkdirSync(join(options.cwd!, 'review'), { recursive: true });
      symlinkSync(join(homedir(), 'external', 'SKILL.md'), join(options.cwd!, 'review', 'SKILL.md'));
    }
    return { stdout: args[0] === 'rev-parse' ? ref : '', stderr: '' };
  };
  await expect(installEntry(entry('market-a'), { execFileFn: symlinkGit })).rejects.toThrow('symbolic link');
  expect(readFileSync(join(homedir(), 'external', 'SKILL.md'), 'utf8')).toBe(md('EXTERNAL'));
  expect(existsSync(join(APP_MANAGED_SKILLS_DIR, 'review'))).toBe(false);
  expect(readdirSync(marketplacePaths(config).tmpDir)).toEqual([]);
});

test('uninstall preserves a replaced target symlink and the foreign directory it points at', async () => {
  await installEntry(entry('market-a'), { execFileFn: git({ review: 'APP' }) });
  const target = join(APP_MANAGED_SKILLS_DIR, 'review');
  rmSync(target, { recursive: true });
  put(join(homedir(), 'external', 'SKILL.md'), md('EXTERNAL'));
  symlinkSync(join(homedir(), 'external'), target, 'dir');
  const result = removeEntry('market-a');
  expect(result.kept).toEqual([{ path: target, reason: 'not-owned' }]);
  expect(lstatSync(target).isSymbolicLink()).toBe(true);
  expect(readFileSync(join(homedir(), 'external', 'SKILL.md'), 'utf8')).toBe(md('EXTERNAL'));
  expect(pathEntryExists(join(GLOBAL_AGENT_SKILLS_DIR, 'review'))).toBe(false);
});

test('directory-mode packs expose every nested skill with stable qualified identities even without links', async () => {
  put(join(GLOBAL_AGENT_SKILLS_DIR, 'review', 'SKILL.md'), md('USER'));
  const pack = { ...entry('directory-pack'), installMode: 'directory' as const };
  const result = await installEntry(pack, { linksRoot: null, execFileFn: git({ 'flows/review': 'FLOW', 'roles/review': 'ROLE', 'roles/ship': 'SHIP' }) });
  expect(result.kind === 'skillpack' && result.skills).toEqual(['directory-pack--review', 'directory-pack--review-2', 'directory-pack--ship']);
  expect(existsSync(join(APP_MANAGED_SKILLS_DIR, 'directory-pack', 'SKILL.md'))).toBe(false);
  expect(loadAllSkills(workspace).map(skill => skill.slug).sort()).toEqual(['directory-pack--review', 'directory-pack--review-2', 'directory-pack--ship', 'review']);
  expect(loadSkillBySlug(workspace, 'directory-pack--review')?.path).toBe(join(APP_MANAGED_SKILLS_DIR, 'directory-pack', 'flows', 'review'));
  expect(loadSkillBySlug(workspace, 'directory-pack--review-2')?.content).toContain('ROLE');
  expect(loadSkillBySlug(workspace, 'directory-pack--ship')?.content).toContain('SHIP');
  await installEntry(pack, { linksRoot: null, execFileFn: git({ 'roles/review': 'ROLE2' }) });
  expect(loadAllSkills(workspace).map(skill => skill.slug).sort()).toEqual(['directory-pack--review-2', 'review']);
  expect(loadSkillBySlug(workspace, 'directory-pack--review-2')?.content).toContain('ROLE2');
  expect(removeEntry('directory-pack').status).toBe('removed');
  expect(loadAllSkills(workspace).map(skill => skill.slug)).toEqual(['review']);
});

for (const variant of ['swapped', 'locally-modified', 'unmarked-legacy'] as const) {
test(`failed ${variant} directory-pack update restores exact provenance, aliases, content and links when lock commit fails`, async () => {
  const pack = { ...entry('directory-pack'), installMode: 'directory' as const };
  await installEntry(pack, { execFileFn: git({ 'flows/review': 'OLD' }) });
  const target = join(APP_MANAGED_SKILLS_DIR, pack.id);
  const alias = 'directory-pack--review';
  const skill = join(target, 'flows', 'review');
  if (variant !== 'swapped') put(join(skill, 'personal.md'), 'USER EDIT');
  if (variant === 'unmarked-legacy') removeInstallMarker(target);
  const lockPath = marketplacePaths(config).lockFile;
  const oldLockBytes = readFileSync(lockPath, 'utf8');
  const oldMarker = readInstallMarker(target);
  if (variant === 'unmarked-legacy') expect(oldMarker).toBeNull();
  else {
    expect(oldMarker?.ref).toBe(ref);
    expect(oldMarker?.skillViews).toEqual({ [alias]: 'flows/review' });
  }
  invalidateSkillsCache(); invalidateOmpSkillsCache();
  const oldVisibleAliases = loadAllSkills(workspace).map(skill => skill.slug);
  const link = join(GLOBAL_AGENT_SKILLS_DIR, alias);
  expect(isSkillLinkTo(link, skill)).toBe(true);
  const newRef = 'b'.repeat(40);
  const updatedGit: ExecFileFn = async (_file, args, options) => {
    if (args.includes('checkout')) put(join(options.cwd!, 'flows', 'review', 'SKILL.md'), md('NEW'));
    return { stdout: args[0] === 'rev-parse' ? newRef : '', stderr: '' };
  };
  const backup = `${lockPath}.fixture-backup`;
  let blocked = false;
  try {
    await expect(installEntry({ ...pack, source: { ...pack.source, ref: newRef } }, {
      execFileFn: updatedGit,
      onProgress(phase) {
        if (phase === 'install' && !blocked) {
          renameSync(lockPath, backup);
          mkdirSync(lockPath);
          blocked = true;
        }
      },
    })).rejects.toThrow(/EISDIR|ENOTEMPTY|EPERM/);
  } finally {
    if (blocked) {
      rmSync(lockPath, { recursive: true, force: true });
      renameSync(backup, lockPath);
    }
  }
  expect(blocked).toBe(true);
  expect(readFileSync(lockPath, 'utf8')).toBe(oldLockBytes);
  expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe(md('OLD'));
  if (variant !== 'swapped') expect(readFileSync(join(skill, 'personal.md'), 'utf8')).toBe('USER EDIT');
  expect(readInstallMarker(target)).toEqual(oldMarker);
  expect(isSkillLinkTo(link, skill)).toBe(true);
  invalidateSkillsCache(); invalidateOmpSkillsCache();
  expect(loadAllSkills(workspace).map(skill => skill.slug)).toEqual(oldVisibleAliases);
  if (variant === 'unmarked-legacy') expect(loadSkillBySlug(workspace, alias)).toBeNull();
  else {
    expect(loadSkillBySlug(workspace, alias)?.content).toContain('OLD');
    expect(loadSkillBySlug(workspace, alias)?.path).toBe(skill);
  }
  expect(readdirSync(marketplacePaths(config).tmpDir)).toEqual([]);
  expect(readdirSync(APP_MANAGED_SKILLS_DIR).some(name => name.includes('.craft-bak-'))).toBe(false);
});
}
