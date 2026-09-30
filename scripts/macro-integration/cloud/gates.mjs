import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
export const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
export const readJSON=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const assert=(b,m)=>{if(!b)throw new Error(m);};
export function safeProof(root,p){assert(typeof p==='string'&&p.length&&!path.isAbsolute(p)&&!p.split(/[\\/]/).includes('..'),'unsafe proof path');const full=fs.realpathSync(path.join(root,p)),base=fs.realpathSync(root)+path.sep;assert(full.startsWith(base),'proof symlink escape');return full;}
export function validateReceipt(r,p,manifest,options={}){
 assert(r.schemaVersion===1,'receipt schema version');assert(r.wpId===p.id,'receipt wrong WP');assert(r.specDigest===manifest.specDigest,'stale spec digest');assert(r.status==='verified','receipt not verified');assert(sha(r.commitSha)&&sha(r.inputSha)&&r.commitSha!==r.inputSha,'receipt invalid or unchanged commit');
 assert(r.review?.status==='approved'&&r.review.reviewer&&r.review.reviewer!==r.owner,'independent review missing');
 assert(Array.isArray(r.changedPaths)&&r.changedPaths.length,'changed paths missing');
 for(const f of r.changedPaths)assert(p.allowedPaths.some(a=>f===a||f.startsWith(a+'/'))||f.startsWith(`proof/macro-integration/${p.id}/`)||f===`plans/macro-integration/cloud/receipts/${p.id}.json`,`unowned changed path ${f}`);
 for(const lane of p.lanes){const l=r.lanes?.[lane];assert(l?.status==='passed',`required lane not passed ${lane}`);assert(['live','fixture'].includes(l.executionMode),`invalid mode ${lane}`);if(['macos-native','provider-live'].includes(lane))assert(l.executionMode==='live',`fixture cannot prove ${lane}`);
 const tests=r.tests?.filter(t=>t.lane===lane)||[];assert(tests.length&&tests.every(t=>t.exitCode===0&&t.command&&t.expected&&t.observed&&t.logPath&&/^[a-f0-9]{64}$/.test(t.sha256)),`test evidence missing ${lane}`);assert(r.negativeControls?.some(n=>n.lane===lane&&n.caught===true&&n.mutation&&n.reproduction&&n.assertion&&n.baselineExitCode===0&&n.mutantExitCode>0&&n.failureKind==='assertion'&&n.baselineLogPath&&n.mutantLogPath&&/^[a-f0-9]{64}$/.test(n.baselineSha256)&&/^[a-f0-9]{64}$/.test(n.mutantSha256)),`negative control missing ${lane}`);
 if(lane==='linux-renderer'||lane==='macos-native')assert(r.visualEvidence?.some(v=>v.lane===lane&&v.path&&v.sha256&&v.viewport&&v.font&&v.state&&v.ariaPath&&v.ariaSha256),`visual evidence missing ${lane}`);
 if(lane==='provider-live')assert(r.providerEvidence?.some(e=>e.readBack===true&&e.provider&&e.path&&e.sha256),`readback missing ${lane}`);
 }
 if(options.verifyProof){const proof=[...r.tests,...(r.visualEvidence||[]),...(r.providerEvidence||[]),...r.negativeControls.flatMap(n=>[{path:n.baselineLogPath,sha256:n.baselineSha256},{path:n.mutantLogPath,sha256:n.mutantSha256}]),...(r.visualEvidence||[]).map(v=>({path:v.ariaPath,sha256:v.ariaSha256}))];for(const e of proof){const rel=e.logPath||e.path;assert(rel.startsWith(`proof/macro-integration/${p.id}/`),'wrong proof owner');assert(sha256(fs.readFileSync(safeProof(options.root,rel)))===e.sha256,`proof checksum mismatch ${rel}`);}}
 if(options.actualChangedPaths){const actual=options.actualChangedPaths(r.inputSha,r.commitSha).sort();assert(JSON.stringify([...r.changedPaths].sort())===JSON.stringify(actual),'self-declared changedPaths differ from git diff');}
 if(options.isAncestor){assert(options.isAncestor(r.inputSha,r.commitSha),'input not ancestor of output');assert(options.isAncestor(r.commitSha,options.inputSha),'dependency commit not integrated');}
 return true;
}
export function overlap(a,b){return a.some(x=>b.some(y=>x===y||x.startsWith(y+'/')||y.startsWith(x+'/')));}
export function ready(manifest,receipts,{active=[],verify=()=>true}={}){
 const errors=[],valid=new Set();for(const p of manifest.workPackages){if(!receipts[p.id])continue;try{validateReceipt(receipts[p.id],p,manifest);verify(receipts[p.id],p);valid.add(p.id);}catch(e){errors.push({id:p.id,error:e.message});}}
 for(const id of active)assert(manifest.workPackages.some(p=>p.id===id),'unknown active WP');
 let pruned=true;while(pruned){pruned=false;for(const p of manifest.workPackages){if(valid.has(p.id)&&!p.dependencies.every(d=>valid.has(d))){valid.delete(p.id);errors.push({id:p.id,error:'verified receipt without verified transitive prerequisites'});pruned=true;}}}
 const invalid=new Set(errors.map(e=>e.id));
 const candidates=manifest.workPackages.filter(p=>!valid.has(p.id)&&!invalid.has(p.id)&&!active.includes(p.id)&&p.dependencies.every(d=>valid.has(d))),selected=[],deferred=[];
 const owned=manifest.workPackages.filter(p=>active.includes(p.id));for(const p of candidates){const conflict=[...owned,...selected].find(o=>overlap(p.allowedPaths,o.allowedPaths));if(conflict)deferred.push({id:p.id,conflictsWith:conflict.id});else selected.push(p);}
 return {ready:selected.map(p=>p.id),deferred,receiptErrors:errors,verified:[...valid],blocked:manifest.workPackages.filter(p=>!valid.has(p.id)&&!candidates.includes(p)).map(p=>({id:p.id,missing:p.dependencies.filter(d=>!valid.has(d)),invalidReceipt:invalid.has(p.id)}))};
}
export function git(root,...args){return cp.execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}).trim();}
export function isAncestor(root,a,b){try{cp.execFileSync('git',['merge-base','--is-ancestor',a,b],{cwd:root,stdio:'ignore'});return true;}catch{return false;}}
export function machinePreflight({actualSha,expectedSha,dirty,diskGiB,ramGiB,cpus,bunVersion,nodeMajor,minimumDisk=8,lane='linux-domain',platform}){
 minimumDisk=lane==='linux-renderer'?16:minimumDisk;
 const checks=[['commit',actualSha===expectedSha,{actual:actualSha,expected:expectedSha}],['clean-checkout',!dirty,{dirty}],['disk',diskGiB>=minimumDisk,{actualGiB:diskGiB,minimumGiB:minimumDisk}],['memory',ramGiB>=8,{actualGiB:ramGiB,minimumGiB:8}],['cpu',cpus>=4,{actual:cpus,minimum:4}],['platform',lane==='macos-native'?platform==='darwin':lane.startsWith('linux')?platform==='linux':true,{actual:platform,lane}],['bun',bunVersion==='1.3.14',{actual:bunVersion,expected:'1.3.14'}],['node',nodeMajor===22,{actual:nodeMajor,expected:22}]];
 return {status:checks.every(c=>c[1])?'ready':'blocked',checks:checks.map(([name,passed,observed])=>({name,passed,observed}))};
}
