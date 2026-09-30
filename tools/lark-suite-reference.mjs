import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plan = resolve(root, 'plans/lark-suite-reference')
const docs = resolve(root, 'docs/lark-suite-reference')
const json = async (name) => JSON.parse(await readFile(resolve(plan, name), 'utf8'))
const emit = async (name, value) => writeFile(resolve(plan, name), JSON.stringify(value, null, 2) + '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const baseline = 'e953786ba7e30fb5da5dca7e88e20e324d5aebab'
const assert = (condition, message) => { if (!condition) throw Error(message) }
const gitBlob = (path) => execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, stdio: ['ignore','pipe','pipe'] })
const crossDependencies = [
 ['LSX-WP-001','CI-008','Generated artifact adoption uses the same content descriptor and aliases'],
 ['LSX-WP-003','CI-008','Applying a generated document requires aggregate CAS and revision receipts'],
 ['LSX-WP-025','CI-011','RepoWiki opens through the same library and document identity'],
]

const coreAliases = [['docs','notes'],['sheets'],['drive'],['wiki'],['base','bases'],['forms'],['chats','messenger'],['contacts'],['meetings','calls'],['calendar'],['tasks'],['email','mail'],['favorites'],['templates'],['reminders'],['announcements'],['okr'],['subscriptions']]
const businessAliases = [['help desk'],['attendance'],['workspace','workplace','suite admin'],['approval'],['recruitment'],['leave'],['purchase'],['out-of-office'],['reimbursement'],['reports','report'],['lingo'],['moments'],['meegle'],['coze'],['tanca hr'],['seleam'],['docugenius'],['subscriptions']]
const targetDecisions = { 'LC-001':'EXTEND_ROX','LC-002':'NEW_ROX_PRIMITIVE','LC-003':'EXTEND_ROX','LC-004':'EXTEND_ROX','LC-005':'EXTEND_ROX','LC-006':'NEW_ROX_PRIMITIVE','LC-007':'NEW_ROX_PRIMITIVE','LC-008':'EXTEND_ROX','LC-009':'EXTEND_ROX','LC-010':'EXTEND_ROX','LC-011':'EXTEND_ROX','LC-012':'ADAPTER','LC-013':'EXTEND_ROX','LC-014':'EXTEND_ROX','LC-015':'EXTEND_ROX','LC-016':'NEW_ROX_PRIMITIVE','LC-017':'NEW_ROX_PRIMITIVE','LC-018':'NEW_ROX_PRIMITIVE' }

// Explicit coverage bindings are observations of UI, not proof of backend writes.
const bindings = {
 'LC-001':['LO-02','LO-03','LO-04','LO-05'], 'LC-002':['LO-03'], 'LC-003':['LO-02'], 'LC-004':['LO-14'], 'LC-005':['LO-06','LO-07','LO-08','LO-09'], 'LC-006':['LO-15'], 'LC-007':['LO-01'], 'LC-008':['LO-13'], 'LC-009':['LO-10'], 'LC-010':['LO-10','LO-11'], 'LC-011':['LO-12','LO-08'], 'LC-012':['LO-16'], 'LC-013':['LO-02','LO-33'], 'LC-014':['LO-06','LO-15'], 'LC-015':['LO-10'], 'LC-016':['LO-19'], 'LC-017':['LO-31'], 'LC-018':['LO-30'],
 'LB-HELPDESK':['LO-26'], 'LB-ATTENDANCE':['LO-18'], 'LB-WORKPLACE':['LO-27','LO-32'], 'LB-APPROVAL':['LO-17'], 'LB-RECRUITMENT':['LO-27'], 'LB-LEAVE':['LO-27'], 'LB-PURCHASE':['LO-27'], 'LB-OOO':['LO-27'], 'LB-REIMBURSEMENT':['LO-17'], 'LB-REPORT':['LO-28'], 'LB-LINGO':['LO-29'], 'LB-MOMENTS':['LO-27'], 'LB-MEEGLE':['LO-20'], 'LB-COZE':['LO-22'], 'LB-TANCA-HR':['LO-21'], 'LB-SELEAM':['LO-23','LO-24','LO-25'], 'LB-DOCUGENIUS':['LO-08','LO-27'], 'LB-SUBSCRIPTIONS':['LO-30']
}

async function build() {
 const captures = await json('live-capture-index.json')
 const liveDoc = await readFile(resolve(docs, '01-live-product-audit.md'), 'utf8')
 const observations = liveDoc.split('\n').filter(line => /^\| LO-\d+ /.test(line)).map(line => {
   const columns = line.split('|').slice(1, -1).map(x=>x.trim())
   const [id, captureSpec] = columns[0].split(' /')
   const captureIds = []
   for (const bit of captureSpec.split(',')) {
     const match = bit.match(/(\d+)(?:[–-](\d+))?/)
     if (!match) throw Error('Invalid capture range: '+bit)
     const low = Number(match[1]), high = Number(match[2] ?? match[1])
     for(let n=low;n<=high;n++) {
       const entry = captures.captures.find(c=>Number(c.id.match(/^\d+/)?.[0])===n)
       if(!entry) throw Error('Missing capture '+n)
       captureIds.push(entry.id)
     }
   }
   return { id, screen:columns[1], evidenceLabel:'OBSERVED', finding:columns[2], roxImplication:columns[3], captureIds, runtimeMutationVerified:false, limitation:'Read-only tenant UI observation; backend, hover timing and mobile not established.' }
 })
 await emit('live-observations.json',{schemaVersion:1,observedOn:'2026-09-30',tool:'Codex Computer Use cua_repl',privateContentIncluded:false,captureIndex:'live-capture-index.json',observations})
 const core = await json('core-catalog.json'), business = await json('business-catalog.json'), ci = await json('code-intelligence.json')
 const features = core.features.map((f,i)=>({id:f.id,name:f.name,aliases:coreAliases[i],classification:f.classification,catalog:'core-catalog.json',catalogRecord:f.id,documentedScreens:f.screenInventory.length,evidenceLabel:'DOCUMENTED',liveObservationIds:bindings[f.id]??[],liveScope:'Only linked observation findings; a launcher is not full editor verification.',targetApproach:targetDecisions[f.id],targetSpec:f.id==='LC-005'?'docs/lark-suite-reference/05-rox-bases-design.md':f.id==='LC-001'?'docs/lark-suite-reference/06-rox-docs-design.md':'docs/lark-suite-reference/02-core-suite.md'}))
 features.push(...business.features.map((f,i)=>({id:f.id,name:f.name,aliases:businessAliases[i],classification:f.classification,catalog:'business-catalog.json',catalogRecord:f.id,documentedScreens:f.documented.screens.length,evidenceLabel:'DOCUMENTED',liveObservationIds:bindings[f.id]??[],liveScope:'Only linked observation findings; vendor onboarding/launchers do not establish private product depth.',targetApproach:f.classification==='thirdPartyAddon'||f.classification==='independentApp'?'ADAPTER':'EXTEND_ROX',targetSpec:'docs/lark-suite-reference/03-business-ecosystem.md'})))
 const ciAliases = [['openwiki','repowiki'],['gitdiagram'],['groma'],['repogrep','repo search'],['zoekt']]
 features.push(...ci.providers.map((p,i)=>({id:p.id,name:p.name,aliases:ciAliases[i],classification:p.classification,catalog:'code-intelligence.json',catalogRecord:p.id,documentedScreens:0,evidenceLabel:p.classification,liveObservationIds:[],liveScope:'Source/public asset audit only; provider not executed and not computer-use observed.',targetApproach:i===3?'REIMPLEMENT':'ADAPTER',targetSpec:'docs/lark-suite-reference/13-code-intelligence.md',uiSpec:'docs/lark-suite-reference/14-code-intelligence-ui.md'})))
 await emit('capabilities.json',{schemaVersion:1,sourceSha:baseline,status:'REFERENCE_AND_PROPOSED_DESIGN',features,duplicates:[{a:'LC-018',b:'LB-SUBSCRIPTIONS',reason:'Core content-distribution model and business ecosystem classification of same feature.'},{a:'LC-016',context:'Workplace Announcement composer',reason:'Group announcement documentation and organization composer observed are related but not asserted identical backend.'}],requiredAliases:['sheets','docs','drive','wiki','okr','chats','meetings','help desk','attendance','announcements','reminders','tasks','bases','contacts','workspace','forms','tanca hr','seleam','approval','recruitment','meegle','leave','purchase','out-of-office','reimbursement','lingo','moments','docugenius','reports','subscriptions','email','favorites','templates','coze','openwiki','gitdiagram','repogrep','groma']})
 const entities = ['Principal','Workspace','Membership','EntityHeader','EntityOrigin','PermissionGrant','EntityLink','DocumentDescriptor','DocumentRevision','BlockAnchor','Base','TableDefinition','FieldDefinition','ViewDefinition','SourceBinding','RowProjection','CustomRecord','FieldValue','Discussion','Message','Mention','AttachmentBinding','ActivityEvent','Notification','SearchProjection','ProviderConnection','ProviderLink','WorkflowDefinition','WorkflowVersion','WorkflowRun','StepReceipt','NativeTask','Project','Company','Contact','MailThread','CalendarEvent','Meeting','Call','AgentSession'].map(id=>({id,status:'PROPOSED',authoritative:!['RowProjection','SearchProjection','EntityHeader'].includes(id)}))
 const relationPairs = [['Workspace','Membership','contains'],['Principal','Membership','holds'],['Workspace','EntityHeader','scopes'],['EntityHeader','PermissionGrant','governedBy'],['EntityHeader','EntityLink','links'],['EntityHeader','DocumentDescriptor','describedBy'],['DocumentDescriptor','DocumentRevision','versions'],['DocumentDescriptor','BlockAnchor','anchors'],['Base','TableDefinition','contains'],['TableDefinition','FieldDefinition','defines'],['TableDefinition','ViewDefinition','presents'],['TableDefinition','SourceBinding','reads'],['SourceBinding','RowProjection','projects'],['RowProjection','NativeTask','nativeAuthority'],['RowProjection','Company','nativeAuthority'],['RowProjection','CustomRecord','customAuthority'],['CustomRecord','FieldValue','stores'],['EntityHeader','Discussion','discussedIn'],['Discussion','Message','contains'],['Message','Mention','mentions'],['EntityHeader','AttachmentBinding','uses'],['EntityHeader','ActivityEvent','changes'],['Principal','Notification','receives'],['EntityHeader','SearchProjection','indexedBy'],['ProviderConnection','ProviderLink','owns'],['WorkflowDefinition','WorkflowVersion','publishes'],['WorkflowVersion','WorkflowRun','executes'],['WorkflowRun','StepReceipt','records'],['Project','NativeTask','contains'],['Company','Contact','contacts'],['Contact','MailThread','interacts'],['Meeting','CalendarEvent','scheduledBy'],['Meeting','Call','conductedBy'],['AgentSession','EntityHeader','authorizedContext']]
 const relations=relationPairs.map(([from,to,type],i)=>({id:'LER-'+String(i+1).padStart(3,'0'),from,to,type}))
 entities.push(...ci.entities.map(e=>({id:e.name,status:'PROPOSED',sourceRecord:e.id,fields:e.fields,semantics:e.semantics})))
 relations.push(...ci.relationships.map(r=>({...r,type:r.meaning,status:'PROPOSED'})),
  {id:'LCI-01',from:'Project',to:'RepositoryBinding',type:'binds'},
  {id:'LCI-02',from:'SourceBinding',to:'RepositoryBinding',type:'reads'},
  {id:'LCI-03',from:'GeneratedArtifact',to:'DocumentDescriptor',type:'adoptsWithSameIdentityAndCAS'},
  {id:'LCI-04',from:'AgentSession',to:'FileSpan',type:'authorizedSnapshotContext'},
  {id:'LCI-05',from:'Claim',to:'VerificationReceipt',type:'semanticallyAssessedBy'})
 await emit('entity-graph.json',{schemaVersion:1,status:'PROPOSED_ROX_NOT_LARK_DATABASE',sourceSha:baseline,refContract:{extends:'Rox2EntityRef',fields:['workspaceId','entityId','revisionId?','accountNamespace?'],initialSubtypes:'page + proposed contentKind; existing note IDs preserved through alias resolution'},entities,relations,invariants:['NativeTask owner/source scoped; no duplicate Base task store','One document authority epoch','No implicit ACL grant from link/mention','Derived aggregate respects querying actor policy','Single aggregate CAS covering document text/tree','Private existing comments not automatically shared','Remote-private offline default denied; optional bounded lease expires fail-closed','Generated wiki/diagram is derived; exact source snapshot remains authority','Dirty source bytes never cited as unchanged parent commit']})
 await buildExecution(ci)
 console.log(JSON.stringify({built:true,features:features.length,observations:observations.length,entities:entities.length}))
}

async function buildExecution(ci) {
 const lsx=await json('work-packages.json')
 const packages=lsx.work_packages.map((p,i)=>({id:p.id,title:p.title,status:p.status,dependencies:p.dependencies,sourceRecord:{path:'plans/lark-suite-reference/work-packages.json',jsonPointer:`/work_packages/${i}`},owner:p.owner,inputs:p.inputs,outputs:p.outputs,allowedWritePaths:p.cloud_packet.allowed_write_paths,sharedPatchPaths:p.cloud_packet.integration_patch_request_paths,cloudPacket:p.cloud_packet}))
 packages.push(...ci.workPackages.map((p,i)=>({id:p.id,title:p.title,status:'PLANNED_NOT_EXECUTED',dependencies:[...p.dependsOn,...crossDependencies.filter(e=>e[1]===p.id).map(e=>e[0])],sourceRecord:{path:'plans/lark-suite-reference/code-intelligence.json',jsonPointer:`/workPackages/${i}`},owner:{planned_role:p.owner,assignment_status:'UNASSIGNED',agent_id:null,shared_existing_file_owner:'integration-owner'},inputs:p.inputs,outputs:p.outputs,allowedWritePaths:p.proposedFiles,sharedPatchPaths:p.existingFiles,cloudPacket:{launch_state:'PREPARED_NOT_LAUNCHED',task_id:p.id,product_baseline_sha:baseline,reference_package_revision:'RESOLVE_FROM_DELIVERY_MANIFEST',reference_package_digest:'RESOLVE_FROM_DELIVERY_MANIFEST',fail_closed_if_unresolved:true,executor_run_id:null,artifact_state:'NOT_PRODUCED',readback_state:'NOT_RUN',allowed_write_paths:p.proposedFiles,integration_patch_request_paths:p.existingFiles,shared_path_owner:'integration-owner',launch_gates:lsx.work_packages[0].cloud_packet.launch_gates,artifact_requirements:lsx.work_packages[0].cloud_packet.artifact_requirements,external_gates:['EG-IDENTITY','CI scoped repository/egress policy','Upstream provider version/license/runtime readiness','Native agent transport when tools used']}})))
 const nodes=packages.map(p=>p.id),edges=packages.flatMap(p=>p.dependencies.map(d=>({from:d,to:p.id,reason:crossDependencies.find(e=>e[0]===d&&e[1]===p.id)?.[2]??'Package prerequisite; implementation receipts required',satisfied:false})))
 graphCheck(nodes,edges.map(e=>[e.from,e.to]))
 const sharedFiles=[...new Set(packages.flatMap(p=>p.sharedPatchPaths))].sort()
 await emit('execution-packages.json',{schemaVersion:1,status:'PREPARED_NOT_LAUNCHED',productBaselineSha:baseline,referencePackageRevision:'RESOLVE_FROM_DELIVERY_MANIFEST',referencePackageDigest:'RESOLVE_FROM_DELIVERY_MANIFEST',noExecutorLaunched:true,sourceContracts:'sourceRecord JSON pointer is normative full PRD/API/DB/ACL/UI/test/DoD packet; this derived file normalizes routing/ownership only',packageCount:packages.length,packages,resourceOwnership:{sharedExistingFileOwner:'integration-owner',sharedFiles,rule:'Workers write only proposed new paths. Existing-file patches are reviewed requests applied serially by integration-owner; dependencies require accepted runtime and readback receipts.'}})
 await emit('execution-dag.json',{schemaVersion:1,status:'PREPARED_NOT_LAUNCHED',nodes,edges,crossProgramDependencies:crossDependencies.map(([from,to,reason])=>({from,to,reason})),topologicalOrder:topological(nodes,edges.map(e=>[e.from,e.to])),resourcePolicy:'Acquire exclusive integration-owner file leases across LSX/CI and prior Macro/Suite programs; no status implies implementation.'})
}

function topological(nodes,edges) {
 graphCheck(nodes,edges)
 const degree=new Map(nodes.map(n=>[n,0])),next=new Map(nodes.map(n=>[n,[]]))
 for(const [a,b] of edges){degree.set(b,degree.get(b)+1);next.get(a).push(b)}
 const queue=nodes.filter(n=>!degree.get(n)),out=[]
 while(queue.length){const n=queue.shift();out.push(n);for(const b of next.get(n)){degree.set(b,degree.get(b)-1);if(!degree.get(b))queue.push(b)}}
 return out
}

function graphCheck(nodes,edges) {
 const ids=new Set(nodes), indegree=new Map(nodes.map(n=>[n,0])), next=new Map(nodes.map(n=>[n,[]]))
 if(ids.size!==nodes.length) throw Error('Duplicate DAG nodes')
 for(const [from,to] of edges){if(!ids.has(from)||!ids.has(to))throw Error('Unknown DAG ref '+from+' → '+to);next.get(from).push(to);indegree.set(to,indegree.get(to)+1)}
 const queue=nodes.filter(n=>indegree.get(n)===0); let visited=0
 while(queue.length){const n=queue.shift();visited++;for(const to of next.get(n)){indegree.set(to,indegree.get(to)-1);if(indegree.get(to)===0)queue.push(to)}}
 if(visited!==nodes.length)throw Error('DAG cycle')
}

async function validate() {
 const checks=[]; const check=(name,fn)=>{fn();checks.push(name)}
 const cap=await json('capabilities.json'), live=await json('live-observations.json'), index=await json('live-capture-index.json'), ent=await json('entity-graph.json')
 const observations=new Set(live.observations.map(o=>o.id)), captures=new Map(index.captures.map(c=>[c.id,c]))
 check('coverage every requested Lark alias',()=>{for(const a of cap.requiredAliases)if(!cap.features.some(f=>f.aliases.includes(a)))throw Error('Missing feature '+a)})
 check('live references and screenshot hashes',()=>{for(const o of live.observations){if(o.runtimeMutationVerified)throw Error('Read-only audit claimed runtime mutation');for(const id of o.captureIds){const c=captures.get(id);if(!c||!/^[0-9a-f]{64}$/.test(c.screenshotSha256??''))throw Error('Bad capture '+id)}}for(const f of cap.features)for(const o of f.liveObservationIds)if(!observations.has(o))throw Error('Unknown observation '+o)})
 check('entity reference integrity',()=>{const ids=new Set(ent.entities.map(e=>e.id));for(const r of ent.relations)if(!ids.has(r.from)||!ids.has(r.to))throw Error('Bad relation '+r.id)})
 const files=[]
 async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,entry.name);if(entry.isDirectory())await walk(path);else if(/\.(md|json)$/.test(entry.name)&&!['validation-report.json','delivery.json','publication.json'].includes(entry.name))files.push(path)}}
 for(const folder of [docs,plan])await walk(folder)
 for(const file of files){const content=await readFile(file,'utf8');if(file.endsWith('.json'))JSON.parse(content);else{for(const match of content.matchAll(/\]\(([^)]+)\)/g)){const target=match[1].split('#')[0];if(!target||/^(?:https?:|mailto:|app:|plugin:)/.test(target))continue;await stat(resolve(dirname(file),target))}}}
 checks.push('JSON parse and relative Markdown links')
 const wp = await json('work-packages.json')
 const packages=wp.work_packages??wp.workPackages??wp.packages
 if(!Array.isArray(packages)||packages.length<32)throw Error('Need 32+ concrete implementation packages')
 const ids=packages.map(p=>p.id), edges=packages.flatMap(p=>(p.dependencies??[]).map(d=>[d,p.id]));graphCheck(ids,edges);checks.push('work package DAG')
 const persisted=await json('dependency-dag.json')
 const edgeSet=edges=>edges.map(([a,b])=>`${a}\0${b}`).sort().join('\n')
 const assertEdges=(a,b)=>assert(edgeSet(a)===edgeSet(b),'Persisted DAG differs from package prerequisites')
 const assertOrder=(order,nodes,edges)=>{assert(new Set(order).size===nodes.length&&order.length===nodes.length&&nodes.every(n=>order.includes(n)),'Incomplete topological order');const pos=new Map(order.map((n,i)=>[n,i]));assert(edges.every(([a,b])=>pos.get(a)<pos.get(b)),'Invalid topological order')}
 check('persisted LSX DAG equality and topological order',()=>{assertEdges(edges,persisted.edges.map(e=>[e.from,e.to]));assertOrder(persisted.topological_order,ids,edges);for(const [i,n] of persisted.nodes.entries())assert(n.packet_ref.json_pointer===`/work_packages/${i}`&&n.id===packages[i].id,'Bad LSX JSON pointer')})
 const assertCloud=c=>{assert(c.launch_state==='PREPARED_NOT_LAUNCHED'&&c.fail_closed_if_unresolved===true,'Fail-open cloud preflight');assert(c.executor_run_id===null&&c.artifact_state==='NOT_PRODUCED'&&c.readback_state==='NOT_RUN','False execution receipt');assert(c.product_baseline_sha===baseline,'Wrong product baseline');assert(c.reference_package_revision==='RESOLVE_FROM_DELIVERY_MANIFEST'&&c.reference_package_digest==='RESOLVE_FROM_DELIVERY_MANIFEST','Source SHA confused with delivery revision/digest');assert(c.shared_path_owner==='integration-owner','Shared-file owner bypass')}
 check('46 detailed LSX contracts and fail-closed cloud packets',()=>{for(const p of packages){for(const k of ['inputs','outputs','domain_entities','changes','tests','acceptance','definition_of_done','risks','complexity','spec_refs','owner'])assert(p[k]!=null,`Missing ${p.id}.${k}`);for(const k of ['api','db','events','acl','ui','realtime'])assert(p.changes[k],`Missing ${p.id}.changes.${k}`);assertCloud(p.cloud_packet);assert(p.owner.shared_existing_file_owner==='integration-owner','Shared owner mismatch')}})
 let anchors=0
 for(const record of Object.values(wp.source_evidence_registry)){const data=gitBlob(record.path);assert(sha(data)===record.blob_sha256,`Source hash mismatch ${record.path}`);const lines=data.toString('utf8').split('\n');for(const a of record.symbols){assert(lines[a.line-1].trim()===a.source_line.trim(),`Source anchor mismatch ${record.path}:${a.line}`);assert(!/^\s*(?:\/\/|\*|import\b)/.test(a.source_line),'Non-declaration anchor');anchors++}}
 checks.push('37 baseline source hashes and exact declaration anchor lines')
 const ci=await json('code-intelligence.json')
 const ciIds=ci.workPackages.map(p=>p.id),ciEdges=ci.workPackages.flatMap(p=>p.dependsOn.map(d=>[d,p.id]));graphCheck(ciIds,ciEdges)
 check('15 detailed CI contracts and required acceptance gates',()=>{for(const p of ci.workPackages){for(const k of ['domainEntities','apiChanges','persistence','events','permissions','screenRefs','realtimeOffline','observableAcceptance','risks','complexity','tests','ownership','seamRefs'])assert(p[k]!=null,`Missing ${p.id}.${k}`);for(const a of p.observableAcceptance)assert(a.expectedStatus==='PASS'&&a.failureStatus==='GAP_BLOCKS_COMPLETION','Gap treated as passing acceptance');for(const path of p.tests.proposed)assert(p.proposedFiles.includes(path),'Unowned proposed test path')}})
 check('CI source/ref/provider/entity integrity',()=>{const sourceIds=new Set(ci.sources.map(s=>s.id));assert(sourceIds.size===ci.sources.length,'Duplicate CI source IDs');const names=new Set(ci.entities.map(e=>e.name));for(const r of ci.relationships)assert(names.has(r.from)&&names.has(r.to),'Invalid CI relation');for(const p of ci.providers)for(const s of p.sourceRefs??[])assert(sourceIds.has(s),'Unknown CI source ref');for(const s of ci.sources)if(s.classification.startsWith('SOURCE_VERIFIED'))assert(/^[a-f0-9]{64}$/.test(s.sha256),'Missing CI source digest')})
 for(const seam of ci.seams)assert(sha(gitBlob(seam.path))===seam.sha256,`CI baseline seam hash ${seam.path}`)
 checks.push(`${ci.seams.length} CI baseline seam hashes`)
 const master=await json('execution-packages.json'), dag=await json('execution-dag.json')
 const masterIds=master.packages.map(p=>p.id),masterEdges=master.packages.flatMap(p=>p.dependencies.map(d=>[d,p.id]));graphCheck(masterIds,masterEdges)
 const assertWrites=ps=>{const owners=new Map();for(const p of ps)for(const path of p.allowedWritePaths){assert(!owners.has(path),`Duplicate worker write path ${path}`);owners.set(path,p.id)}return owners}
 const assertRouting=(p,n)=>{const writes=p.id.startsWith('CI-')?n.proposedFiles:n.cloud_packet.allowed_write_paths;const shared=p.id.startsWith('CI-')?n.existingFiles:n.cloud_packet.integration_patch_request_paths;const equal=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());assert(equal(p.allowedWritePaths,writes)&&equal(p.cloudPacket.allowed_write_paths,writes),'Normative worker allowlist mismatch');assert(equal(p.sharedPatchPaths,shared)&&equal(p.cloudPacket.integration_patch_request_paths,shared),'Normative shared-path allowlist mismatch')}
 const owned=assertWrites(master.packages)
 check('combined LSX/CI DAG, record pointers, ownership and cloud readiness',()=>{assert(masterIds.length===packages.length+ciIds.length,'Incomplete combined execution pack');assertEdges(masterEdges,dag.edges.map(e=>[e.from,e.to]));assertOrder(dag.topologicalOrder,masterIds,masterEdges);assert(master.resourceOwnership.sharedExistingFileOwner==='integration-owner','Combined owner mismatch');for(const p of master.packages){assertCloud(p.cloudPacket);const source=p.id.startsWith('CI-')?ci.workPackages:packages;const i=Number(p.sourceRecord.jsonPointer.split('/').pop());assert(source[i]?.id===p.id,'Bad combined record pointer');assertRouting(p,source[i]);assert(p.status==='PLANNED_NOT_EXECUTED','False implementation status')}})
 for(const path of owned.keys()){let exists=true;try{gitBlob(path)}catch{exists=false}assert(!exists,`Proposed path exists at baseline ${path}`)}
 checks.push('all worker proposed paths absent at baseline')
 let issueDraftCount=0
 try{const draft=await json('publication-catalog.json');issueDraftCount=draft.issues.length;assert(issueDraftCount===masterIds.length,'Incomplete issue catalog');assert(new Set(draft.issues.map(i=>i.id)).size===issueDraftCount,'Duplicate issue draft IDs');for(const i of draft.issues){const body=await readFile(resolve(root,i.bodyFile),'utf8');assert(sha(body)===i.bodySha256,'Issue body digest mismatch '+i.id);assert(body.length<=60000,'Oversized issue body');assert(body.includes(`<!-- ROX-LARK-PACKAGE:${i.id} -->`),'Missing issue marker')}checks.push('61 issue draft markers, sizes and exact body digests')}catch(e){if(e.code!=='ENOENT')throw e}
 const negative=[];for(const [name,fn] of [['cycle',()=>graphCheck(['a','b'],[['a','b'],['b','a']])],['unknown dependency',()=>graphCheck(['a'],[['b','a']])],['duplicate DAG node',()=>graphCheck(['a','a'],[])],['persisted graph mismatch',()=>assertEdges([['a','b']],[])],['invalid topo',()=>assertOrder(['b','a'],['a','b'],[['a','b']])],['duplicate worker write',()=>assertWrites([{id:'a',allowedWritePaths:['x']},{id:'b',allowedWritePaths:['x']}])],['unresolved fail-open',()=>assertCloud({...master.packages[0].cloudPacket,fail_closed_if_unresolved:false})],['fake cloud run',()=>assertCloud({...master.packages[0].cloudPacket,executor_run_id:'fake'})],['baseline as delivery',()=>assertCloud({...master.packages[0].cloudPacket,reference_package_revision:baseline})],['worker allowlist mismatch',()=>assertRouting({...master.packages[0],allowedWritePaths:['invented/new.ts']},packages[0])],['cloud allowlist bypass',()=>assertRouting({...master.packages[0],cloudPacket:{...master.packages[0].cloudPacket,allowed_write_paths:['invented/new.ts']}},packages[0])]]){let rejected=false;try{fn()}catch{rejected=true}if(!rejected)throw Error('Insensitive control '+name);negative.push(name)}
 const report={schemaVersion:1,status:'PASS_ARTIFACTS_ONLY',productRuntimeVerified:false,checkedAt:new Date().toISOString(),checks,negativeControlsRejected:negative,counts:{features:cap.features.length,liveObservations:live.observations.length,captureAttempts:index.captures.length,entities:ent.entities.length,lsxWorkPackages:packages.length,codeIntelligenceWorkPackages:ciIds.length,workPackages:masterIds.length,dependencyEdges:masterEdges.length,workerWritePaths:owned.size,verifiedSourceAnchors:anchors,codeIntelligenceSeams:ci.seams.length,issueDrafts:issueDraftCount},artifactHashes:Object.fromEntries(await Promise.all(files.map(async file=>[relative(root,file),sha(await readFile(file))])))}
 await emit('validation-report.json',report);console.log(JSON.stringify(report.counts));console.log('PASS artifact checks; no product/runtime/cloud execution claimed')
}

if(process.argv.includes('--build'))await build()
if(process.argv.includes('--validate'))await validate()
if(!process.argv.includes('--build')&&!process.argv.includes('--validate'))throw Error('Use --build and/or --validate')
