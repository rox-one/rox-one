import { readFile, lstat, mkdir, readdir, copyFile, realpath, symlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const here = import.meta.dir;
const original = '/Users/t/.agents/state/rox-compound-70/wp01-holdout-20260930T125031Z';
const current = '/Users/t/Projects/rox-one-compound-implementation';
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const oldReportBytes = await readFile(resolve(original, 'work/report.json'));
const oldReport = JSON.parse(oldReportBytes.toString());
const oldReceipt = await readJson(resolve(original, 'work/report.receipt.json'));
if (sha(oldReportBytes) !== 'f7db97bcba07368dc143e6ef61428974c51fd0a10e0943c9ffb0ca76ec45bbdd' || oldReceipt.artifact.sha256 !== sha(oldReportBytes)) throw new Error('Original report/receipt SHA mismatch');
const oldArtifacts = [];
for (const entry of oldReport.artifacts) {
  const bytes = await readFile(resolve(original, entry.path));
  if (sha(bytes) !== entry.sha256 || (entry.bytes !== undefined && bytes.byteLength !== entry.bytes)) throw new Error('Original artifact mismatch: ' + entry.path);
  oldArtifacts.push({ path: entry.path, sha256: sha(bytes), bytes: bytes.byteLength });
}
const oldManifest = await readJson(resolve(original, 'source-manifest.json'));
const oldSourceVerification = [];
for (const entry of oldManifest.files) {
  const bytes = await readFile(resolve(original, 'source', entry.path));
  if (sha(bytes) !== entry.sha256) throw new Error('Original snapshot mismatch: ' + entry.path);
  oldSourceVerification.push({ path: entry.path, sha256: sha(bytes) });
}
await Bun.write(resolve(here, 'original-artifact-verification.json'), JSON.stringify({ recordedAt:new Date().toISOString(), reportPath:resolve(original,'work/report.json'), reportSha256:sha(oldReportBytes), receiptPath:resolve(original,'work/report.receipt.json'), receiptSha256:sha(await readFile(resolve(original,'work/report.receipt.json'))), artifacts:oldArtifacts, sourceManifestSha256:sha(await readFile(resolve(original,'source-manifest.json'))), originalSnapshotFilesVerified:oldSourceVerification.length, originalOracleSha256:oldReport.verification.identicalFinalTestSha256, originalOutcomes:oldReport.verification, untouchedOriginal:true }, null, 2));
const paths = new Set<string>(oldManifest.files.map((x: {path:string}) => x.path));
async function walk(relative: string) {
  const entries = await readdir(resolve(current, relative), {withFileTypes:true});
  for(const entry of entries) {
    if(['node_modules','dist','.git','out'].includes(entry.name)) continue;
    const path = relative + '/' + entry.name;
    if(entry.isDirectory()) await walk(path);
    else if(entry.isFile()) paths.add(path);
  }
}
for(const dir of ['apps/workspace-service/src','apps/workspace-service/migrations','apps/electron/src','packages/core/src','packages/server-core/src','packages/shared/src','tests/macro-integration']) await walk(dir);
for(const path of ['docs/spec.md','docs/plan.md','docs/macro-integration/wp-01-implementation.md','docs/macro-integration/wp-01-runtime.md','docs/decisions/2026-09-30-wp01-independent-evaluator-scope.md','plans/compound-implementation/progress.json']) paths.add(path);
const files = [];
for(const path of [...paths].sort()) {
  const full = resolve(current,path), stat = await lstat(full);
  if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('Source path is not a regular file: '+path);
  const bytes = await readFile(full);
  const entry = {path,sha256:sha(bytes),bytes:bytes.byteLength};
  for(const variant of ['baseline','mutation']) {
    const dest = resolve(here,variant,path);
    await mkdir(dirname(dest),{recursive:true});
    await copyFile(full,dest);
    const copied = await lstat(dest);
    if(!copied.isFile() || copied.isSymbolicLink() || copied.nlink!==1 || (copied.dev===stat.dev && copied.ino===stat.ino) || sha(await readFile(dest))!==entry.sha256) throw new Error('Physical fixture verification failed: '+dest);
  }
  files.push(entry);
}
const sourcePostCopyDiffs = [];
for(const entry of files) if(sha(await readFile(resolve(current,entry.path)))!==entry.sha256) sourcePostCopyDiffs.push(entry.path);
if(sourcePostCopyDiffs.length) throw new Error('Concurrent source changed during snapshot: '+sourcePostCopyDiffs.join(','));
const head = await new Response(Bun.spawn(['git','rev-parse','HEAD'],{cwd:current,stdout:'pipe'}).stdout).text();
const status = await new Response(Bun.spawn(['git','status','--porcelain=v1'],{cwd:current,stdout:'pipe'}).stdout).text();
const manifest = {recordedAt:new Date().toISOString(),sourceRoot:current,inputHead:head.trim(),gitStatus:status,sourcePostCopyDiffs,files,physicalCopies:{baseline:true,mutation:true,sourceHardlinks:false,sourceSymlinks:false}};
await Bun.write(resolve(here,'current-source-manifest.json'),JSON.stringify(manifest,null,2));
const oracle = await readFile(resolve(original,'work/holdout.test.ts'));
if(sha(oracle)!=='b8222c7836463af8639e7f9a85475470ffb50effd5ac6a12918e1894803fe741') throw new Error('Original oracle changed');
await Bun.write(resolve(here,'holdout.test.ts'),oracle);
const dependencies = [];
for(const variant of ['baseline','mutation']) {
  const root=resolve(here,variant);
  await mkdir(resolve(root,'node_modules'),{recursive:true});
  for(const dep of ['ws','jose','shell-quote']) {
    const target=await realpath(resolve(current,'node_modules',dep));
    const metadataBytes=await readFile(resolve(target,'package.json'));
    const metadata=JSON.parse(metadataBytes.toString());
    await symlink(target,resolve(root,'node_modules',dep));
    dependencies.push({variant,dependency:dep,target,version:metadata.version,packageJsonSha256:sha(metadataBytes),access:'external dependency read-only symlink'});
  }
  const paths={ '@craft-agent/shared/protocol':[resolve(root,'packages/shared/src/protocol/index.ts')], '@craft-agent/shared/utils':[resolve(root,'packages/shared/src/utils/index.ts')], '@craft-agent/core/types':[resolve(root,'packages/core/src/types/index.ts')] };
  await Bun.write(resolve(here,variant+'.tsconfig.json'),JSON.stringify({compilerOptions:{paths}},null,2));
}
const repositoryPath='apps/workspace-service/src/modules/identity/repository.ts';
const repository=await readFile(resolve(here,'mutation',repositoryPath),'utf8');
const oldLine=oldReport.mutation.original, newLine=oldReport.mutation.mutated;
if(repository.split(oldLine).length!==2) throw new Error('Expected unique original mutation target');
const mutated=repository.replace(oldLine,newLine);
await Bun.write(resolve(here,'mutation',repositoryPath),mutated);
const mutation={path:repositoryPath,line:repository.split('\n').findIndex(line=>line===oldLine)+1,original:oldLine,mutated:newLine,originalSha256:sha(repository),mutatedSha256:sha(mutated),identicalSelectedMutation:oldLine===oldReport.mutation.original&&newLine===oldReport.mutation.mutated};
await Bun.write(resolve(here,'preparation.json'),JSON.stringify({recordedAt:new Date().toISOString(),head:head.trim(),sourceManifestSha256:sha(await readFile(resolve(here,'current-source-manifest.json'))),fileCount:files.length,oracleSha256:sha(oracle),dependencies,mutation,productionHooks:false,testHooks:false,mocks:false},null,2));
console.log(JSON.stringify({oldArtifactHashesVerified:oldArtifacts.length,oldSnapshotHashesVerified:oldSourceVerification.length,currentFilesPhysicallyCopiedPerVariant:files.length,head:head.trim(),oracleSha256:sha(oracle),mutation}));
