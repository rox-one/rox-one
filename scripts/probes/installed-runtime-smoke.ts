/**
 * Read-only installed-resource smoke. Run with pinned Bun from this checkout:
 * bun scripts/probes/installed-runtime-smoke.ts <ROX.app|Windows-install|Resources>
 * Optional: --manifest expected.json --write-manifest expected.json --output proof.json
 * Only packaged resources and an isolated temporary home are read. No UI/network.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { extractFile } from '@electron/asar';
import { parse as parseYaml } from 'yaml';
import { prepareOmpRoxRuntimeConfig } from '../../packages/shared/src/agent/omp-first-run.ts';
import { OMP_WORKER_POLICY_SOURCE } from '../../packages/shared/src/agent/omp-worker-policy.ts';
import { readOmpResumeFile, withOmpRequiredModes, writeOmpIdentity } from '../../packages/shared/src/agent/omp-history.ts';

interface Manifest { version: 1; appVersion: string; skillCount: number; workerPolicySha256: string; files: Record<string, string> }
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const args = process.argv.slice(2);
const targetArg = args.shift();
if (!targetArg) throw new Error('Supply .app, Windows install root or Resources directory');
const flags = new Map<string, string>();
while (args.length) {
  const flag = args.shift()!;
  const value = args.shift();
  if (!['--manifest', '--write-manifest', '--output'].includes(flag) || !value) throw new Error(`Invalid argument ${flag}`);
  flags.set(flag, resolve(value));
}
const trustedSkills = resolve(import.meta.dir, '../../apps/electron/resources/skills');
function safeFile(root: string, key: string): string {
  if (isAbsolute(key) || key.split(/[\\/]/).includes('..')) throw new Error('Manifest path escapes resource root');
  const file = join(root, key);
  const canonicalRoot = realpathSync(root);
  const canonicalFile = realpathSync(file);
  const rel = relative(canonicalRoot, canonicalFile);
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Resource link escapes package');
  return file;
}
function expectedManifest(): Manifest {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const file = join(dir, entry.name);
      const key = relative(trustedSkills, file).split(/[\\/]/).join('/');
      safeFile(trustedSkills, key);
      if (statSync(file).isDirectory()) walk(file);
      else files[key] = sha(readFileSync(file));
    }
  };
  walk(trustedSkills);
  return { version: 1, appVersion: '0.11.8', skillCount: 330, workerPolicySha256: sha(OMP_WORKER_POLICY_SOURCE), files };
}
const expected: Manifest = flags.has('--manifest')
  ? JSON.parse(readFileSync(flags.get('--manifest')!, 'utf8'))
  : expectedManifest();
if (expected.version !== 1 || expected.appVersion !== '0.11.8' || expected.skillCount !== 330) throw new Error('Expected final 0.11.8 / 330-skill manifest');
if (flags.has('--write-manifest')) writeFileSync(flags.get('--write-manifest')!, JSON.stringify(expected, null, 2) + '\n', { mode: 0o600 });
const target = resolve(targetArg);
const resources = [target, join(target, 'Contents', 'Resources'), join(target, 'resources')]
  .find(candidate => existsSync(join(candidate, 'skills', 'SKILLS.lock')) && existsSync(join(candidate, 'app.asar')));
if (!resources) throw new Error('Installed app.asar and packaged skills were not found');
const skills = join(resources, 'skills');
for (const [key, hash] of Object.entries(expected.files)) {
  if (sha(readFileSync(safeFile(skills, key))) !== hash) throw new Error(`Packaged resource hash mismatch: ${key}`);
}
const requested = JSON.parse(readFileSync(safeFile(skills, 'REQUESTED-SKILLS.json'), 'utf8'));
const lock = JSON.parse(readFileSync(safeFile(skills, 'SKILLS.lock'), 'utf8'));
const slugs = lock.packs.flatMap((pack: { skills: string[] }) => pack.skills);
if (requested.skillCount !== 330 || new Set(slugs).size !== 330 || slugs.length !== 330) throw new Error('Packaged skill catalog is incomplete or colliding');
const asar = join(resources, 'app.asar');
const pkg = JSON.parse(extractFile(asar, 'package.json').toString('utf8'));
if (pkg.version !== '0.11.8') throw new Error('Installed app version is not final 0.11.8');
const main = extractFile(asar, 'dist/main.cjs').toString('utf8');
// Extract without executing the Electron bundle. Esbuild preserves tagged raw
// template contents; minified identifier names do not affect this match.
const policy = [...main.matchAll(/String\.raw\s*`([^`]*)`/g)]
  .map(match => match[1]!).find(source => source.includes('ROX mandatory execution policy'));
if (!policy || sha(policy) !== expected.workerPolicySha256 || policy !== OMP_WORKER_POLICY_SOURCE) throw new Error('Compiled worker policy is absent or differs from expected bytes');

const isolated = mkdtempSync(join(tmpdir(), 'rox-installed-smoke-'));
try {
  const home = join(isolated, 'home');
  mkdirSync(home, { recursive: true });
  const profile = prepareOmpRoxRuntimeConfig({ runtimeRoot: join(isolated, 'runtime'), homeDir: home,
    sourceAgentDir: join(home, '.omp', 'agent'), bundleRoot: skills, disabledPacks: [], configFiles: '' });
  const profileSkills = readdirSync(join(profile.agentDir, 'skills')).filter(name => !name.startsWith('.'));
  if (profileSkills.length !== 330 || slugs.some((slug: string) => !profileSkills.includes(slug))) throw new Error('Isolated OMP profile lacks packaged skills');
  const overlay = parseYaml(readFileSync(join(profile.agentDir, 'rox-runtime-policy.yml'), 'utf8'));
  if (overlay.task?.maxEffort !== 'max') throw new Error('Profile does not remove the worker effort ceiling');
  const worker = join(profile.agentDir, 'rox-worker-policy.js');
  if (!overlay.extensions.includes(worker) || readFileSync(worker, 'utf8') !== policy) throw new Error('Generated profile lacks the compiled worker policy');
  for (const pack of lock.packs) for (const slug of pack.skills) {
    const linked = join(profile.agentDir, 'skills', slug, 'SKILL.md');
    const packaged = safeFile(skills, `${pack.slug}/${slug}/SKILL.md`);
    if (realpathSync(linked) !== realpathSync(packaged)) throw new Error(`Profile skill is not the packaged snapshot: ${slug}`);
  }

  // Exercise actual shared parsing with CRLF and native title/header layout.
  const history = join(isolated, 'history');
  mkdirSync(history);
  const transcript = join(history, 'windows spaces_fixture.jsonl');
  const records = [{ type: 'title', title: 'Windows CRLF' }, { type: 'session', version: 3, id: 'fixture-native-id' },
    { type: 'message', id: 'turn1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'retained' }] } }];
  writeFileSync(transcript, records.map(record => JSON.stringify(record)).join('\r\n') + '\r\n');
  writeOmpIdentity(history, 'fixture-native-id', transcript);
  const identity = join(history, 'active-session.json');
  writeFileSync(identity, readFileSync(identity, 'utf8').replace(/\n/g, '\r\n'));
  if (readOmpResumeFile(history, 'fixture-native-id') !== transcript) throw new Error('CRLF history restoration failed');
  const crlfPrompt = 'orchestrate workflowz ultrathink\r\n\r\nrequest';
  if (withOmpRequiredModes(crlfPrompt) !== crlfPrompt) throw new Error('CRLF directive duplicated or altered');
  writeFileSync(transcript, readFileSync(transcript, 'utf8') + '{broken}\r\n');
  let rejected = false;
  try { readOmpResumeFile(history, 'fixture-native-id'); } catch { rejected = true; }
  if (!rejected) throw new Error('Corrupt CRLF transcript silently restored');
  if (win32.basename('C:\\outside\\session.jsonl') === 'C:\\outside\\session.jsonl'
    || win32.basename('..\\session.jsonl') === '..\\session.jsonl'
    || win32.basename(basename(transcript)) !== basename(transcript)) throw new Error('Windows identity basename contract failed');
  const evidence = { version: 1, appVersion: pkg.version, platform: process.platform,
    expectedManifestSha256: sha(JSON.stringify(expected)), verifiedPackagedFiles: Object.keys(expected.files).length,
    packagedSkillCount: 330, isolatedProfileSkillCount: profileSkills.length,
    compiledWorkerPolicySha256: sha(policy), isolatedHome: true, credentialReads: false,
    crlfTitleHeaderIdentityResume: true, corruptInteriorRejected: true, win32BasenameEscapesRejected: true,
    scope: 'Packaged resource hashes, compiled policy extraction and source-shared profile generation. No Electron execution, native skill discovery, UI, remote provider or Windows filesystem acceptance.', assertionsPassed: true };
  if (flags.has('--output')) writeFileSync(flags.get('--output')!, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
  profile.dispose();
} finally { rmSync(isolated, { recursive: true, force: true }); }
