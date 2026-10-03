import { SQL } from 'bun';
import { readFile, lstat, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadProtectedWorkspaceDatabaseUrl } from './baseline/apps/workspace-service/src/auth/postgres-identity.ts';
const here=import.meta.dir;
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const json=async(path:string)=>JSON.parse(await readFile(resolve(here,path),'utf8'));
const manifest=await json('current-source-manifest.json');
const preparation=await json('preparation.json');
const original=await json('original-artifact-verification.json');
const oracleSha=sha(await readFile(resolve(here,'holdout.test.ts')));
if(oracleSha!==original.originalOracleSha256)throw new Error('Oracle changed');
const copies=[],currentSourceDiffs=[];
for(const variant of ['baseline','mutation']) {
  const changes=[];
  for(const entry of manifest.files){
    const dest=resolve(here,variant,entry.path),stat=await lstat(dest),hash=sha(await readFile(dest));
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new Error('Invalid physical source '+dest);
    if(hash!==entry.sha256)changes.push({path:entry.path,originalSha256:entry.sha256,sha256:hash});
  }
  if(variant==='baseline'&&changes.length!==0)throw new Error('Baseline modified');
  if(variant==='mutation'&&(changes.length!==1||changes[0].path!==preparation.mutation.path||changes[0].sha256!==preparation.mutation.mutatedSha256))throw new Error('Mutation scope mismatch');
  copies.push({variant,verifiedRegularFiles:manifest.files.length,changes});
}
for(const entry of manifest.files){
  let hash:string|null=null;try{hash=sha(await readFile(resolve(manifest.sourceRoot,entry.path)))}catch{}
  if(hash!==entry.sha256)currentSourceDiffs.push({path:entry.path,snapshotSha256:entry.sha256,currentSha256:hash});
}
const originalBase='/Users/t/.agents/state/rox-compound-70/wp01-holdout-20260930T125031Z';
for(const entry of original.artifacts)if(sha(await readFile(resolve(originalBase,entry.path)))!==entry.sha256)throw new Error('Original artifact altered');
if(sha(await readFile(original.reportPath))!==original.reportSha256)throw new Error('Original report altered');
const runs=[];
for(const variant of ['baseline','mutation']){
  const execution=await json(variant+'.execution.json'),evidence=await json(variant+'.evidence.json');
  const stderr=await readFile(resolve(here,variant+'.stderr.log'),'utf8'),stdout=await readFile(resolve(here,variant+'.stdout.log'),'utf8');
  if(sha(stderr)!==execution.stderrSha256||sha(stdout)!==execution.stdoutSha256||execution.testSha256!==oracleSha)throw new Error('Execution log hash mismatch');
  const pass=Number(stderr.match(/\n\s*(\d+) pass\n/)?.[1]),fail=Number(stderr.match(/\n\s*(\d+) fail\n/)?.[1]),assertions=Number(stderr.match(/\n\s*(\d+) expect\(\) calls/)?.[1]);
  const expected=variant==='baseline'?{pass:6,fail:0,assertions:64,exitCode:0}:{pass:4,fail:2,assertions:41,exitCode:1};
  if(pass!==expected.pass||fail!==expected.fail||assertions!==expected.assertions||execution.exitCode!==expected.exitCode)throw new Error('Unexpected actual outcome '+variant);
  if(variant==='mutation'&&(!stderr.includes('error: HTTP list leaked private Project title')||!stderr.includes('error: WS list leaked private Project title')))throw new Error('Expected mutation failures not present');
  if(evidence.restarts!==1||evidence.counters.projectsCreated!==4||evidence.cleanup.remainingOwnedSchemas!==0||evidence.cleanup.listenerAliveAfterClose!==false||!evidence.cleanup.ownedIssuerStateRemoved)throw new Error('Incomplete actual test or cleanup');
  let processAlive=true;try{process.kill(execution.pid,0)}catch{processAlive=false}
  let issuerStateExists=true;try{await access(resolve(here,'issuer-'+variant+'-'+evidence.runId))}catch{issuerStateExists=false}
  if(processAlive||issuerStateExists)throw new Error('Owned process/state cleanup incomplete');
  runs.push({variant,...expected,pid:execution.pid,startedAt:execution.startedAt,finishedAt:execution.finishedAt,testSha256:oracleSha,executionPath:variant+'.execution.json',evidencePath:variant+'.evidence.json',stdoutPath:variant+'.stdout.log',stderrPath:variant+'.stderr.log',schema:evidence.schema,seed:evidence.seed,runId:evidence.runId,counters:evidence.counters,restarts:evidence.restarts,cleanup:{...evidence.cleanup,processAlive,issuerStateExists}});
}
const database=new SQL(await loadProtectedWorkspaceDatabaseUrl('/Users/t/.agents/state/rox-compound-workspace/postgres-environment.json'),{max:1});
const pg=[];try{
  for(const run of runs){
    if(!/^holdout_(baseline|mutation)_[a-f0-9]{16}$/.test(run.schema))throw new Error('Unsafe owned schema');
    const rows=await database.unsafe<{count:number}[]>('SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1',[run.schema]);
    if(rows[0]?.count!==0)throw new Error('Owned schema remains '+run.schema);
    pg.push({schema:run.schema,remaining:rows[0].count});
  }
}finally{await database.close()}
await Bun.write(resolve(here,'source-verification.json'),JSON.stringify({recordedAt:new Date().toISOString(),copies,currentSourceDiffs,oracleSha256:oracleSha,sourceManifestSha256:sha(await readFile(resolve(here,'current-source-manifest.json'))),oldArtifactsStillIntact:true},null,2));
await Bun.write(resolve(here,'cleanup-verification.json'),JSON.stringify({recordedAt:new Date().toISOString(),protectedLoaderUsed:true,credentialsPrinted:false,databaseConnectionClosed:true,ownedSchemasOnly:true,schemas:pg,runs:runs.map(x=>({variant:x.variant,pid:x.pid,...x.cleanup}))},null,2));
const artifactPaths=['prepare.ts','run.ts','finalize.ts','holdout.test.ts','preparation.json','current-source-manifest.json','original-artifact-verification.json','source-verification.json','cleanup-verification.json','baseline.tsconfig.json','mutation.tsconfig.json','tsconfig.json',...runs.flatMap(run=>[run.executionPath,run.evidencePath,run.stdoutPath,run.stderrPath])];
const artifacts=[];for(const path of artifactPaths){const bytes=await readFile(resolve(here,path));artifacts.push({path,sha256:sha(bytes),bytes:bytes.byteLength})}
const report={schemaVersion:1,recordedAt:new Date().toISOString(),evaluator:'/root/wp01_closure_ultra',executionSurface:'current-session native subagent; actual Bun child processes',task:'WP-01 current-source independent second-variant revalidation',accepted:true,scope:'Independent second-variant API/privacy/persistence gate only; no native, cold archive or Git delivery claim',source:{root:manifest.sourceRoot,inputHead:manifest.inputHead,manifestPath:'current-source-manifest.json',manifestSha256:sha(await readFile(resolve(here,'current-source-manifest.json'))),physicalFileCountPerVariant:manifest.files.length,currentSourceDiffs},original:{reportPath:original.reportPath,reportSha256:original.reportSha256,artifactHashesVerified:original.artifacts.length,snapshotFileHashesVerified:original.originalSnapshotFilesVerified,preserved:true},independence:{samePreviouslyIndependentlySelectedSecondVariant:true,rootBodyActorNegativeControlIsDistinct:true,custodialBlindingClaimed:false,assertionsUnchanged:true,oracleSha256:oracleSha,productionHooks:false,testHooks:false,mocks:false},mutation:preparation.mutation,verification:{baseline:runs[0],mutation:runs[1],failingAssertionLine:183,failingAssertions:['HTTP list leaked private Project title: expected false, received true','WS list leaked private Project title: expected false, received true'],detailWriteForgeryAndRestartControlsPassed:true},cleanup:{path:'cleanup-verification.json',complete:true},artifacts,pendingRootGates:['current native two-profile acceptance and reviewed screenshots','native durable offline retry/cancel/restart scope acceptance','current cold archive readback','source-bound commit/push/readback','full WP-01 normative closure audit integration'],program:{packageCount:143,NOT_STARTED:130,noProgressEdits:true}};
await Bun.write(resolve(here,'report.json'),JSON.stringify(report,null,2));
const bytes=await readFile(resolve(here,'report.json'));
await Bun.write(resolve(here,'report.receipt.json'),JSON.stringify({task:'WP-01-current-independent',evaluator:'/root/wp01_closure_ultra',artifact:{path:resolve(here,'report.json'),sha256:sha(bytes),bytes:bytes.byteLength},verification:{accepted:true,baseline:{pass:6,fail:0,assertions:64},mutation:{pass:4,fail:2,assertions:41},cleanup:true},recordedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({reportPath:resolve(here,'report.json'),reportSha256:sha(bytes),baseline:'6/0/64',mutation:'4/2/41',sourceDiffs:currentSourceDiffs,cleanup:true}));
