import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const macro = process.argv[2];
const rox = process.argv[3] ?? process.cwd();
if (!macro) throw new Error('usage: bun audit-source.mjs <Macro snapshot> [ROX snapshot]');
const out = join(rox, 'plans/macro-integration');
mkdirSync(out, { recursive: true });
const files = root => execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split('\n');
const sha = root => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const mf = files(macro), rf = files(rox);
const snapshots = { macro: { repository: 'macro-inc/macro', sha: sha(macro) }, rox: { repository: 'rox-one/rox-one', sha: sha(rox) } };
writeFileSync(join(out, 'source-snapshots.json'), JSON.stringify({ schemaVersion: 1, auditedAt: '2026-09-30', snapshots }, null, 2)+'\n');

const cargo = new Map();
for (const path of mf.filter(p=>p.endsWith('Cargo.toml'))) {
  const data = Bun.TOML.parse(readFileSync(join(macro,path),'utf8'));
  if (data.package?.name) cargo.set(data.package.name, { path, data });
}
const workspace = Bun.TOML.parse(readFileSync(join(macro,'Cargo.toml'),'utf8'));
const workspaceDeps = workspace.workspace?.dependencies ?? {};
const edges = [];
for (const [name, { path, data }] of cargo) {
  const groups = [['normal', data.dependencies], ['dev',data['dev-dependencies']],['build',data['build-dependencies']]];
  for (const [target, td] of Object.entries(data.target ?? {})) {
    groups.push([`normal:${target}`,td.dependencies], [`dev:${target}`,td['dev-dependencies']]);
  }
  for (const [kind,deps] of groups) for (const [alias,original] of Object.entries(deps ?? {})) {
    const dep = original?.workspace ? workspaceDeps[alias] : original;
    const packageName = dep?.package ?? alias;
    if (cargo.has(packageName)) edges.push({ from:name, to:packageName, kind, alias, manifest:path, featureGate:dep?.optional ?? false, features:dep?.features ?? [], defaultFeatures:dep?.['default-features'] ?? true });
  }
}
writeFileSync(join(out,'macro-backend-dependencies.json'),JSON.stringify({schemaVersion:1,snapshot:snapshots.macro,kind:'resolved-local-manifest-edges-not-runtime-callgraph',nodes:[...cargo].map(([id,v])=>({id,path:v.path,deployable:v.path.startsWith('services/')})),edges},null,2)+'\n');

const routes = [];
for (const path of mf.filter(p=>p.startsWith('apps/web/src/') && /(?:route|routes|registry)/i.test(p) && /\.tsx?$/.test(p) && !p.includes('.test.'))) {
  const lines=readFileSync(join(macro,path),'utf8').split('\n');
  for(let i=0;i<lines.length;i++) if (/\b(?:path|id):\s*['"`]/.test(lines[i])) routes.push({path,line:i+1,declaration:lines[i].trim()});
}
writeFileSync(join(out,'macro-route-inventory.json'),JSON.stringify({schemaVersion:1,snapshot:snapshots.macro,note:'Literal route candidates; runtime registration verified separately in product map',routes},null,2)+'\n');

const licenses=[];
for(const [key,root,fs] of [['macro',macro,mf],['rox',rox,rf]]) for(const path of fs) {
  if(/(?:^|\/)(?:LICENSE|NOTICE|COPYING|THIRD_PARTY_LICENSES)(?:[^/]*)$/i.test(path)) {
    const content=readFileSync(join(root,path),'utf8');
    licenses.push({repository:snapshots[key].repository,sha:snapshots[key].sha,path,firstLines:content.split('\n').slice(0,5),sha256:new Bun.CryptoHasher('sha256').update(content).digest('hex')});
  }
}
const declarations=[];
for(const [key,root,fs] of [['macro',macro,mf],['rox',rox,rf]]) for(const path of fs.filter(p=>p.endsWith('package.json')||p.endsWith('Cargo.toml'))) {
  try { const data=path.endsWith('.json')?JSON.parse(readFileSync(join(root,path),'utf8')):Bun.TOML.parse(readFileSync(join(root,path),'utf8')); const lic=data.license ?? data.package?.license; if(lic) declarations.push({repository:snapshots[key].repository,sha:snapshots[key].sha,path,license:lic}); } catch {}
}
writeFileSync(join(out,'license-inventory.json'),JSON.stringify({schemaVersion:1,files:licenses,declarations,note:'Tracked license/manifests audit, not complete dependency license clearance or legal opinion'},null,2)+'\n');
console.log(JSON.stringify({snapshots,cargoNodes:cargo.size,cargoEdges:edges.length,routeCandidates:routes.length,licenseFiles:licenses.length,licenseDeclarations:declarations.length}));
