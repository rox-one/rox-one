import fs from 'node:fs';
import cp from 'node:child_process';
const root=process.cwd(),macro=process.env.MACRO_SOURCE_DIR||'/Users/t/Projects/macro-source-audit-20260930';
const current={'macro-inc/macro':'767a999a5f0901896959ee1f5b315999b1dea0ed','rox-one/rox-one':'249b3b44220bcfbd7d467de9cfc18f76e1c37807'};
const prior=JSON.parse(fs.readFileSync('plans/macro-integration/reverification.json'));
const git=(dir,...args)=>cp.execFileSync('git',args,{cwd:dir,encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const evidence=['rox','collab','domains','inventory'].flatMap(n=>JSON.parse(fs.readFileSync(`plans/macro-integration/evidence-${n}.json`)));
const records=evidence.map(e=>{const dir=e.repository==='macro-inc/macro'?macro:root,before=git(dir,'rev-parse',`${e.sha}:${e.path}`),previous=git(dir,'rev-parse',`${prior.current[e.repository]}:${e.path}`),after=git(dir,'rev-parse',`${current[e.repository]}:${e.path}`);return{evidenceId:e.id,repository:e.repository,path:e.path,symbol:e.symbol,originalSha:e.sha,currentSha:current[e.repository],originalBlob:before,previousBlob:previous,currentBlob:after,status:before===after?'identical-source':'reviewed-change',changedSinceRevision3:previous!==after};});
const review=records.filter(r=>r.originalBlob!==r.currentBlob).map(r=>({...r,review:r.evidenceId==='D065'?'toggleScreenShare remains; createCallState adds automatic reload hold for non-idle/non-failed lifecycle, cleanup releases hold. New cache-upgrade behavior reviewed separately.':prior.changedReview.find(x=>x.evidenceId===r.evidenceId)?.result||'REQUIRES_REVIEW'}));
if(review.some(r=>r.review==='REQUIRES_REVIEW'))throw Error('unreviewed original evidence change');
const refs=[
 ['apps/web/src/lib/core/util/reloadForNewerBuild.ts','holdAutomaticReload / reloadForNewerBuild',52,98,'Automatic reload holds and hidden+online+no text gate; explicit prompt can still reload.'],
 ['apps/web/src/lib/graphql-cache/host/retirable-host.ts','createRetirableCacheHost',4,58,'Retired host routes stale captured calls to noop cache; source queue bypass must not be transplanted into ROX authoritative command journal.'],
 ['apps/web/src/lib/graphql-cache/worker/coordinator-takeover.ts','CACHE_TAKEOVER_VERSION / parseCacheTakeoverMessage',3,110,'Scope/database takeover protocol separate from hashed app build; compatible wire version retains unknown field tolerance.'],
 ['apps/web/src/lib/graphql-cache/worker/coordinator-router.ts','answerTakeover',1742,1775,'Only holder answers; strictly newer build can supersede, equality/older do not yield.'],
 ['apps/web/src/features/channel/Call/CallContext.tsx','createCallState / holdReloadDuringCall',1632,1670,'Call lifecycle holds automatic reload and releases on idle/failed/dispose.'],
 ['apps/web/src/lib/core/util/upload.ts','uploadFile',410,458,'Upload holds automatic reload and releases in finally.'],
 ['crates/client/turso-opfs/src/browser.rs','BUSY_ENTRY_WAIT_MS / retry_busy_entry',1730,1792,'Idempotent OPFS entry retry only on named busy exception with bounded deadline; not proof of corruption.'],
 ['apps/web/src/lib/service-clients/service-storage/graphql-soup.ts','createRetirableCacheHost / onSuperseded',459,502,'Host retirement and newer-build reload connected to GraphQL transport.'],
 ['apps/web/src/lib/core/util/reloadForNewerBuild.test.ts','reloadForNewerBuild tests',55,137,'Source tests cover hidden/visible/manual/offline/holds/text/once; not executed by this audit.']
].map(([path,symbol,lineStart,lineEnd,claim],i)=>{const sha=current['macro-inc/macro'],text=git(macro,'show',`${sha}:${path}`);if(lineEnd>text.split('\n').length)throw Error('invalid source range '+path);return{id:`V4-SRC${String(i+1).padStart(2,'0')}`,repository:'macro-inc/macro',sha,path,symbol,lineStart,lineEnd,claim,blob:git(macro,'rev-parse',`${sha}:${path}`),url:`https://github.com/macro-inc/macro/blob/${sha}/${path}#L${lineStart}-L${lineEnd}`};});
const report={schemaVersion:1,checkedAt:new Date().toISOString(),current,previous:prior.current,method:'immutable git blob comparisons plus explicit changed-source review',records,changedReview:review,deltaEvidence:refs,counts:{originalRecords:records.length,identical:records.filter(r=>r.status==='identical-source').length,changed:review.length,changedSinceRevision3:records.filter(r=>r.changedSinceRevision3).length,newSourceRefs:refs.length},runtime:'Macro/source tests not executed; ROX product features not implemented; planning validation is separate'};
fs.writeFileSync('plans/macro-integration/source-reverification-v4.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.counts));
