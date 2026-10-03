import fs from 'node:fs';import path from 'node:path';import cp from 'node:child_process';import crypto from 'node:crypto';import vm from 'node:vm';import assert from 'node:assert/strict';import test from 'node:test';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));process.chdir(root);
// Real git source reads are cached; all output writes and GitHub calls are simulated.
const sourceCache=new Map();
const script=fs.readFileSync('scripts/rox-suite/issues.mjs','utf8').replace(/^import .*;\n/gm,'');
const manifestPaths=['docs/rox-suite/issue-drafts/product/product.json','docs/rox-suite/issue-drafts/meetings/meetings.json','docs/rox-suite/issue-drafts/collaboration.json','docs/rox-suite/issue-drafts/services.json'];
const items=manifestPaths.flatMap(p=>{const m=JSON.parse(fs.readFileSync(p,'utf8'));return Array.isArray(m)?m:m.issues;});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const remotes=()=>items.map((x,i)=>({number:9000+i,title:`[ROX Suite][${x.id}] ${x.title}`,url:`https://github.com/rox-one/rox-one/issues/${9000+i}`,state:'OPEN',body:''}));
const receipt=remote=>({schemaVersion:1,repository:'rox-one/rox-one',status:'PUBLISHED_AND_READBACK_VERIFIED',bundleDigest:'historical-bundle',privateImagesPublished:false,issues:remote.map((x,i)=>({id:items[i].id,...x}))});
function run(cmd,{remote=[],prior=null,badReadback=false,overrides=new Map(),source=script}={}){const writes=new Map(),calls=[];if(prior)writes.set('plans/rox-suite/publication.json',JSON.stringify(prior));
const fakeFs={...fs,existsSync:p=>writes.has(String(p))||(!String(p).endsWith('publication.json')&&fs.existsSync(p)),readFileSync:(p,encoding)=>{p=String(p);if(overrides.has(p))return overrides.get(p);if(writes.has(p))return encoding?writes.get(p):Buffer.from(writes.get(p));return fs.readFileSync(p,encoding);},writeFileSync:(p,value)=>writes.set(String(p),String(value)),mkdirSync:()=>{}};
const fakeCp={execFileSync:(bin,args,opt)=>{if(bin!=='gh'){assert.equal(bin,'git');assert.equal(args[0],'show');const key=args.join('\0');if(!sourceCache.has(key))sourceCache.set(key,cp.execFileSync(bin,args,opt));return sourceCache.get(key);}calls.push(args);assert.equal(args[0],'issue');assert(!args.includes('--body'));assert(!args.some(a=>/clipboard|png$/i.test(a)));if(args[1]==='list')return JSON.stringify(remote);if(args[1]==='create'){assert(args.includes('--body-file'));const title=args[args.indexOf('--title')+1];const n=9000+remote.length;const r={number:n,title,url:`https://github.com/rox-one/rox-one/issues/${n}`,state:'OPEN',body:fakeFs.readFileSync(args[args.indexOf('--body-file')+1],'utf8')};remote.push(r);return r.url;}const r=remote.find(r=>r.number===Number(args[2]));assert(r,'remote missing');if(args[1]==='edit'){assert(args.includes('--body-file'));r.body=fakeFs.readFileSync(args[args.indexOf('--body-file')+1],'utf8');return '';}if(args[1]==='view')return JSON.stringify({...r,body:badReadback?r.body+'MISMATCH':r.body});throw Error('unexpected gh '+args);}};
let error=null;try{vm.runInNewContext(source,{fs:fakeFs,path,cp:fakeCp,crypto,process:{cwd:()=>root,argv:['node','script',cmd]},console:{log:()=>{}},Buffer},{timeout:30000});}catch(e){error=e.message;}
return {error,calls,writes,remote,receipt:()=>JSON.parse(writes.get('plans/rox-suite/publication.json')||'null')};}
const check=(name,f)=>test(name,f);
check('baseline collect validates 30 exact drafts',()=>{const r=run('collect');assert.equal(r.error,null);assert.equal(JSON.parse(r.writes.get('plans/rox-suite/issues.json')).issues.length,30);assert.equal(r.calls.length,0);});
check('fresh publication uses body-file for 30 separate issues',()=>{const r=run('publish');assert.equal(r.error,null);assert.equal(r.calls.filter(x=>x[1]==='create').length,30);assert.equal(r.receipt().status,'IN_PROGRESS');});
check('remote title recovery creates zero duplicates',()=>{const r=run('publish',{remote:remotes()});assert.equal(r.error,null);assert.equal(r.calls.filter(x=>x[1]==='create').length,0);assert.equal(r.receipt().issues.length,30);});
check('partial receipt resumes without duplicate creation',()=>{const remote=remotes(),prior=receipt(remote);prior.issues=prior.issues.slice(0,10);const r=run('publish',{remote,prior});assert.equal(r.error,null);assert.equal(r.calls.filter(x=>x[1]==='create').length,0);assert.equal(r.receipt().issues.length,30);});
check('all dependency and soft references become numeric GitHub URLs',()=>{const remote=remotes(),r=run('link-and-verify',{remote,prior:receipt(remote)});assert.equal(r.error,null);assert.equal(r.receipt().status,'PUBLISHED_AND_READBACK_VERIFIED');assert.equal(r.calls.filter(x=>x[1]==='view').length,30);for(const x of items){const t=r.writes.get('docs/rox-suite/published/'+x.id+'.md');for(const d of [...(x.dependsOn||[]),...(x.relatedRequirementIds||[])]){const n=9000+items.findIndex(y=>y.id===d);assert(t.includes(`https://github.com/rox-one/rox-one/issues/${n}`));}assert(!/\/issues\/RS-/.test(t));}});
check('readback mismatch downgrades previous verified bundle before editing',()=>{const remote=remotes(),r=run('link-and-verify',{remote,prior:receipt(remote),badReadback:true});assert.match(r.error,/readback mismatch/);assert.equal(r.receipt().status,'IN_PROGRESS');assert.equal(r.receipt().previousVerifiedBundle,'historical-bundle');});
check('duplicate remote ID title fails without creation',()=>{const remote=remotes();remote.push({...remote[0],number:9999,url:'https://github.com/rox-one/rox-one/issues/9999'});const r=run('publish',{remote});assert.match(r.error,/duplicate remote/);assert.equal(r.calls.filter(x=>x[1]==='create').length,0);});
check('foreign repository receipt rejected before GitHub calls',()=>{const remote=remotes(),prior=receipt(remote);prior.repository='other/repo';const r=run('link-and-verify',{remote,prior});assert.match(r.error,/identity\/repository mismatch/);assert.equal(r.calls.length,0);});
check('unknown prerequisite is rejected before any write',()=>{const p=manifestPaths[0],m=JSON.parse(fs.readFileSync(p,'utf8'));m[0].dependsOn=['RS-UNKNOWN-99'];const r=run('collect',{overrides:new Map([[p,JSON.stringify(m)]])});assert.match(r.error,/unknown prerequisite/);assert.equal(r.writes.size,0);});
check('private screenshot marker is rejected without leaking body',()=>{const p=items[0].bodyFile,s=fs.readFileSync(p,'utf8')+'\nclipboard-2026-test';const r=run('publish',{overrides:new Map([[p,s]])});assert.match(r.error,/private screenshot marker/);assert(!r.error.includes('clipboard-2026-test'));assert.equal(r.calls.length,0);});
check('RS strings in numeric relatedIssues are rejected',()=>{const p=manifestPaths[0],m=JSON.parse(fs.readFileSync(p,'utf8'));m[0].relatedIssues=['RS-MCP-01'];const r=run('collect',{overrides:new Map([[p,JSON.stringify(m)]])});assert.match(r.error,/invalid existing issue/);assert.equal(r.writes.size,0);});

check('normalized draft refreshes verified hash and preserves initial creation hash across reruns',()=>{
 const remote=remotes(),prior=receipt(remote),first=items[0],current=fs.readFileSync(first.bodyFile),creation=sha(Buffer.concat([current,Buffer.from('\n')]));
 for(const [i,r]of prior.issues.entries())r.draftBodySha256=sha(fs.readFileSync(items[i].bodyFile));
 prior.issues[0].draftBodySha256=creation;
 assert.notEqual(creation,sha(current));
 const r=run('link-and-verify',{remote,prior});assert.equal(r.error,null);
 const verified=r.receipt().issues.find(x=>x.id===first.id);
 assert.equal(verified.initialDraftBodySha256,creation);assert.equal(verified.draftBodySha256,sha(current));
 for(const x of items)assert.equal(r.receipt().issues.find(y=>y.id===x.id).draftBodySha256,sha(fs.readFileSync(x.bodyFile)));
 const again=run('link-and-verify',{remote,prior:r.receipt()});assert.equal(again.error,null);
 const retained=again.receipt().issues.find(x=>x.id===first.id);assert.equal(retained.initialDraftBodySha256,creation);assert.equal(retained.draftBodySha256,sha(current));
 assert.equal(r.calls.filter(x=>x[1]==='create').length,0);assert.equal(again.calls.filter(x=>x[1]==='create').length,0);
 const failed=run('link-and-verify',{remote,prior,badReadback:true});assert.match(failed.error,/readback mismatch/);
 assert.equal(failed.receipt().issues[0].draftBodySha256,creation);assert.equal(failed.receipt().issues[0].initialDraftBodySha256,undefined);
 // Sensitivity: removing refresh must fail the exact normalized-hash assertion.
 const noRefresh=script.replace('r.draftBodySha256=hash(fs.readFileSync(x.bodyFile));','');assert.notEqual(noRefresh,script);
 const stale=run('link-and-verify',{remote,prior,source:noRefresh});assert.equal(stale.error,null);
 assert.throws(()=>assert.equal(stale.receipt().issues[0].draftBodySha256,sha(current)),assert.AssertionError);
 // Sensitivity: unconditional history overwrite must fail the creation-hash assertion on resume.
 const overwrite=script.replace('r.initialDraftBodySha256??=r.draftBodySha256;','r.initialDraftBodySha256=r.draftBodySha256;');assert.notEqual(overwrite,script);
 const lost=run('link-and-verify',{remote,prior:r.receipt(),source:overwrite});assert.equal(lost.error,null);
 assert.throws(()=>assert.equal(lost.receipt().issues[0].initialDraftBodySha256,creation),assert.AssertionError);
});
