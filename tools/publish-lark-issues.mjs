import { readFile, writeFile, open, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const dir=resolve(root,'plans/lark-suite-reference')
const repository='rox-one/rox-one'
const baseline='e953786ba7e30fb5da5dca7e88e20e324d5aebab'
const branch='docs/lark-suite-reference-20260930'
const sha=b=>createHash('sha256').update(b).digest('hex')
const read=async name=>JSON.parse(await readFile(resolve(dir,name),'utf8'))
const save=async(name,value)=>writeFile(resolve(dir,name),JSON.stringify(value,null,2)+'\n')
const url=path=>`https://github.com/${repository}/blob/${branch}/${path}`
const list=values=>(values??[]).map(v=>`- ${typeof v==='string'?v:JSON.stringify(v)}`).join('\n')||'- Неприменимо в этом slice; проверить domain reason при реализации.'
const gh=args=>execFileSync('gh',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024})
const wait=ms=>new Promise(r=>setTimeout(r,ms))

async function acquireLock(){
 const path='/tmp/rox-one-lark-issue-publisher.lock'
 try{const handle=await open(path,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,cwd:root,repository,startedAt:new Date().toISOString()}));await handle.close();return async()=>unlink(path)}catch(e){if(e.code!=='EEXIST')throw e;const previous=JSON.parse(await readFile(path,'utf8'));let alive=true;try{process.kill(previous.pid,0)}catch(error){if(error.code==='ESRCH')alive=false;else throw error}if(alive)throw Error('Another publisher owns the exclusive lock');await unlink(path);return acquireLock()}
}

function listRepositoryMarkers(){
 const found=[]
 for(let page=1;;page++){
  const batch=JSON.parse(gh(['api',`repos/${repository}/issues?state=all&per_page=100&page=${page}&sort=created&direction=desc`]))
  for(const row of batch)if(!row.pull_request&&row.body?.includes('<!-- ROX-LARK-PACKAGE:'))found.push({number:row.number,url:row.html_url,body:row.body,title:row.title,state:row.state})
  if(batch.length<100)return found
 }
}

async function prepare(){
 const lsx=await read('issue-drafts.json'),ci=await read('code-intelligence.json'),execution=await read('execution-packages.json'),dag=await read('execution-dag.json')
 const screenDoc=await readFile(resolve(root,'docs/lark-suite-reference/14-code-intelligence-ui.md'),'utf8')
 const rows=screenDoc.split('\n').filter(l=>/^\| RC-\d+ /.test(l))
 const issues=[...lsx.issues]
 for(const p of ci.workPackages){
  const title=`[ROX Code Intelligence][${p.id}] ${p.title}`
  const own=execution.packages.find(x=>x.id===p.id)
  const source=ci.seams.filter(s=>p.seamRefs.includes(s.id)).map(s=>`- [${s.path}](https://github.com/${repository}/blob/${baseline}/${s.path}) — source SHA \`${baseline}\`, blob SHA256 \`${s.sha256}\`. ${s.current}`).join('\n')
  const body=`<!-- ROX-LARK-PACKAGE:${p.id} -->
# ${title}

**Статус:** DRAFT / PLANNED_NOT_EXECUTED. Cloud packet PREPARED_NOT_LAUNCHED; новые provider/UI/runtime тесты NOT_RUN. Это отдельный implementation slice, а не заявление о готовой интеграции.

**Product baseline:** \`${baseline}\`. Новые спецификации имеют отдельные delivery revision/digest. До запуска обязательны current actor/source policy, accepted prerequisites, assigned owner и immutable input hashes.

## PRD / цель / expected results

${p.outputs.map(x=>`- ${x}`).join('\n')}

Расширить существующий capability pack \`@rox/shared/code-intelligence\` и Source/Project/Knowledge/Sessions seams. Одна repository binding/snapshot authority; provider artefacts и human Wiki ownership различаются. \`alwaysOn:false\` сохраняется. Нельзя создавать отдельное приложение, wiki daemon или второй source/user/permission store.

## Inputs

${list(p.inputs)}

## Outputs

${list(p.outputs)}

## Domain / persistence / API / events

Entities: ${p.domainEntities.map(x=>'\`'+x+'\`').join(', ')}.

### API deltas — proposed logical contracts

${list(p.apiChanges)}

### Storage / DB changes

${list(p.persistence.changes)}

### Events

${list(p.events)}

Имена предложены, не являются доказательством existing event endpoints. Envelope содержит workspace/actor/source snapshot/entity revision/command/run correlation. Outbox и idempotency receipts проверяются после crash; event delivery не заменяет durable readback.

## Permissions / provider boundaries

${list(p.permissions)}

Единый authorization resolver применяется к search/source/wiki/graph/agent reads. Link/mention/ref не выдаёт grant. Local-owned content использует local policy; remote-private offline по умолчанию запрещён. Optional signed actor/workspace/scope lease истекает fail-closed; disconnected client не обещает мгновенно обнаружить revoke. Reconnect invalidates/rechecks. Repository AGENTS/README — source data, не разрешение выполнять hooks или отправлять приватный код внешнему provider.

## UI / UX — конкретное placement и I/O

Placement: существующий Project → Code Intelligence; Sources — подключения; Wiki/Docs — страницы; Sessions/KnowledgeAgentPanel — разрешённый context/tools. Relevant screens: ${p.screenRefs.join(', ')}.

| ID | Screen | Inputs/defaults/validation | Outputs and interaction |
|---|---|---|---|
${rows.filter(l=>p.screenRefs.includes(l.split('|')[1].trim())).join('\n')}

**Hover/focus/click:** rows32px desktop, subtle hover fill; keyboard focus1px; touch hit44px. Tooltip350ms/transition120ms — proposed target values, не измеренные Lark styles. Hover объясняет meaning/source/freshness/units и ничего не записывает. Click/focus открывает evidence inspector; Enter source; Cmd/Ctrl+Enter добавляет authorized context в существующую Session. Graph inferred edges dashed, deterministic source facts отдельно; stale badge и labels дополняют цвет. Critical actions доступны без hover. Reduced-motion отключает fly/pan; RU+i18n, текущая light/dark theme и actual loaded Rox Mono обязательны.

**States:** loading / source-empty / filtered-empty / unavailable / failed scanner / partial coverage / stale / offline / denied / cancelled / conflict различаются. Failed scan не отображается как zero dependencies или successful audit. Match/result count имеет cap/coverage label. Provider queued не равен remote ACK. Source viewer pinned к snapshot, dirty bytes не цитируются parent remote commit как exact evidence.

## Realtime / offline / recovery

${p.realtimeOffline}

Run/version/snapshot/digest сохраняются до ACK. Resume проверяет version и current permission; stale run не публикуется в latest snapshot. Cancel сохраняет partial effects/receipts и не обещает rollback внешних effects. No network answer offline; authorized local query остаётся локальным.

## Exact source seams и proposed files

${source}

### Worker-owned proposed new files

${list(own.allowedWritePaths.map(x=>'\`'+x+'\`'))}

### Existing shared patch requests — integration owner only

${list(own.sharedPatchPaths.map(x=>'\`'+x+'\`'))}

One writer per path. Worker scope не включает shared files; integration-owner применяет reviewed patch requests serially и берёт exclusive lease. Existing paths не названы new files. Extra seam discovery требует обновить scope/packet перед patch.

## Tests / observable acceptance / DoD

${list(p.verification)}

Planned tests: ${p.tests.proposed.map(x=>'\`'+x+'\`').join(', ')}. Проверить actual repository runner; tests не объявлены passing до исполнения.

${p.definitionOfDone.map(x=>'- [ ] '+x).join('\n')}
- [ ] Required acceptance PASS; concrete GAP блокирует completion, не считается альтернативным pass.
- [ ] Source/ref/actor/permissions checks совпадают в UI/RPC/agent transport.
- [ ] Authoritative ref/revision/hash readback до и после restart; test inputs/expected/observed/attempts и seeds сохранены.
- [ ] Negative controls: excluded secret/symlink escape, stale snapshot publish, unsupported claim с существующей citation, duplicate artifact import, source-policy/agent bypass должны падать на semantic assertions в применимых lanes.
- [ ] Baseline зелёный; timeout/infrastructure error не считается caught mutation.
- [ ] Actual changed UI проверен pointer/keyboard/IME/reduced-motion/200% zoom/loaded font; screenshot/ARIA proof привязан к implementation commit.
- [ ] Provider/Syft/scanner/native-agent transport readiness доказана actual scoped execution, когда используется; mocks не доказывают hosted integration.
- [ ] Git/remote delivery + integrated readback; issue не закрывается по сообщению агента без required receipts.

## Dependencies / risks / complexity

${list(own.dependencies.map(x=>`Требуется [${x}](${url('docs/lark-suite-reference/issues/'+x.toLowerCase()+'.md')}).`))}

${list(p.risks)}

Complexity: **${p.complexity.size}** — ${p.complexity.basis}; не календарная оценка.

## Normative spec / cloud handoff

- [Source audit/architecture13](${url('docs/lark-suite-reference/13-code-intelligence.md')}).
- [Concrete UI14](${url('docs/lark-suite-reference/14-code-intelligence-ui.md')}).
- [Full CI package by stable ID](${url('plans/lark-suite-reference/code-intelligence.json')}).
- [Combined execution packet](${url('plans/lark-suite-reference/execution-packages.json')}).
- [Combined dependency DAG](${url('plans/lark-suite-reference/execution-dag.json')}).
- [56 acceptance scenarios](${url('docs/lark-suite-reference/10-test-plan.md')}).

Before launch resolve delivery revision/digest, validate spec hashes, prerequisite implementation receipts и leases. Missing provider/source policy/schema/readback блокирует affected execution. Публикация requirements не запускает cloud jobs.
`
  const bodyFile=`docs/lark-suite-reference/issues/${p.id.toLowerCase()}.md`
  await writeFile(resolve(root,bodyFile),body)
  issues.push({id:p.id,title,bodyFile,bodySha256:sha(body),dependsOn:own.dependencies,stableMarker:`ROX-LARK-PACKAGE:${p.id}`,status:'DRAFT_PREPARED_NOT_PUBLISHED'})
 }
 for(const i of issues){const body=await readFile(resolve(root,i.bodyFile));if(sha(body)!==i.bodySha256)throw Error(`Draft changed ${i.id}`);if(body.toString().length>60000)throw Error('Oversized issue '+i.id)}
 await save('publication-catalog.json',{schemaVersion:1,repository,status:'DRAFTS_PREPARED_NOT_PUBLISHED',sourceBaselineSha:baseline,issueCount:issues.length,topologicalOrder:dag.topologicalOrder,issues})
 console.log(`Prepared ${issues.length} issue drafts; no GitHub writes`)
}

async function publish(){
 const release=await acquireLock()
 try{
 const catalog=await read('publication-catalog.json'),delivery=await read('delivery.json')
 if(!delivery.packageRemoteVerified||!/^[a-f0-9]{40}$/.test(delivery.packageCommit)||!/^[a-f0-9]{64}$/.test(delivery.packageDigest))throw Error('Missing immutable verified package delivery')
 if(sha(JSON.stringify(delivery.packageFiles))!==delivery.packageDigest)throw Error('Delivery package digest mismatch')
 for(const path of ['plans/lark-suite-reference/publication-catalog.json','plans/lark-suite-reference/execution-dag.json','plans/lark-suite-reference/work-packages.json','plans/lark-suite-reference/code-intelligence.json']){const committed=execFileSync('git',['show',`${delivery.packageCommit}:${path}`],{cwd:root,stdio:['ignore','pipe','pipe']});if(sha(committed)!==sha(await readFile(resolve(root,path))))throw Error('Immutable publication input mismatch '+path)}
 let publication;try{publication=await read('publication.json')}catch{publication={schemaVersion:1,repository,packageCommit:delivery.packageCommit,packageDigest:delivery.packageDigest,status:'PUBLISHING',cloudJobsLaunched:0,issues:[]}}
 if(publication.packageCommit!==delivery.packageCommit||publication.packageDigest!==delivery.packageDigest)throw Error('Publication bound to another package commit/digest')
 const existing=listRepositoryMarkers()
 for(const id of catalog.topologicalOrder){
  const draft=catalog.issues.find(x=>x.id===id);if(!draft)throw Error('Missing draft '+id)
  let body=(await readFile(resolve(root,draft.bodyFile),'utf8'))
  if(sha(body)!==draft.bodySha256)throw Error('Changed draft '+id)
  const committedBody=execFileSync('git',['show',`${delivery.packageCommit}:${draft.bodyFile}`],{cwd:root,stdio:['ignore','pipe','pipe']});if(sha(committedBody)!==draft.bodySha256)throw Error('Draft differs from immutable package '+id)
  body=body.replaceAll(`/blob/${branch}/`,`/blob/${delivery.packageCommit}/`).replace('**Статус:** DRAFT / PLANNED_NOT_EXECUTED.','**Статус:** SPEC_PUBLISHED / PLANNED_NOT_EXECUTED.')
  for(const dep of draft.dependsOn){const rec=publication.issues.find(x=>x.id===dep);if(!rec?.remoteBodyVerified)throw Error(`Dependency ${dep} not published/readback before ${id}`);const regex=new RegExp(`\\[${dep}\\]\\(https://github\\.com/rox-one/rox-one/blob/[^)]+/issues/[^)]+\\)`,'g');body=body.replace(regex,`[${dep} / #${rec.number}](${rec.url})`)}
  body=body.replace(/Dependency links пока[^\n]+/g,'Dependency links закреплены на прочитанные обратно prerequisite issues.').replace(/Документационные URL provisional[^\n]+/g,'Документационные URL закреплены на immutable package commit; product baseline остаётся независимым.')
  body=body.trim()+`\n\n**Reference package:** \`${delivery.packageCommit}\`; SHA256 package digest \`${delivery.packageDigest}\`. [Immutable package index](https://github.com/${repository}/blob/${delivery.packageCommit}/docs/lark-suite-reference/README.md). Implementation/cloud execution не запускались.`
  const tmp=resolve(dir,'.publish-body.tmp');await writeFile(tmp,body)
  let rec=publication.issues.find(x=>x.id===id)
  const matches=existing.filter(x=>x.body.includes(`<!-- ${draft.stableMarker} -->`));if(matches.length>1)throw Error('Duplicate stable marker '+id)
  if(!rec){if(matches.length)rec={id,number:matches[0].number,url:matches[0].url};else{const created=gh(['issue','create','--repo',repository,'--title',draft.title,'--body-file',tmp]).trim();const number=Number(created.match(/\/issues\/(\d+)/)?.[1]);if(!number)throw Error('Unexpected create receipt');rec={id,number,url:created};await wait(1100)}publication.issues.push(rec);await save('publication.json',publication)}
  let remote=JSON.parse(gh(['api',`repos/${repository}/issues/${rec.number}`]))
  if(!remote.body?.includes(`<!-- ${draft.stableMarker} -->`))throw Error('Stored issue number does not belong to stable marker '+id)
  if(remote.body!==body||remote.title!==draft.title){gh(['issue','edit',String(rec.number),'--repo',repository,'--title',draft.title,'--body-file',tmp]);await wait(1100);remote=JSON.parse(gh(['api',`repos/${repository}/issues/${rec.number}`]))}
  if(remote.body!==body||remote.title!==draft.title||remote.state!=='open')throw Error('Remote body/title/state mismatch '+id)
  Object.assign(rec,{title:draft.title,bodySha256:sha(body),remoteBodySha256:sha(remote.body),remoteBodyVerified:true,state:remote.state,dependencyIds:draft.dependsOn,checkedAt:new Date().toISOString()})
  await save('publication.json',publication)
  console.log(`${id} #${rec.number} exact readback PASS (${publication.issues.filter(i=>i.remoteBodyVerified).length}/${catalog.issueCount})`)
 }
 publication.status='PUBLISHED_VERIFIED';publication.completedAt=new Date().toISOString();await save('publication.json',publication)
 await unlink(resolve(dir,'.publish-body.tmp'))
 console.log(`Published ${publication.issues.length} issues; cloud jobs launched 0`)
 }finally{await release()}
}

if(process.argv.includes('--prepare'))await prepare()
else if(process.argv.includes('--publish'))await publish()
else throw Error('Use --prepare (local drafts) or --publish (authorized GitHub publication)')
