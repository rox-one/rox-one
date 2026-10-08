import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('new dialog captures default profile, persists ceiling, rejects expansion and preserves legacy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-session-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,realpathSync}=await import('node:fs');const {join}=await import('node:path');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
const {WorkspaceWorkStore}=await import('./packages/server-core/src/workspace-work/store.ts');
const {WorkspaceWorkService}=await import('./packages/server-core/src/workspace-work/service.ts');
const {SessionManager,setSessionPlatform,createManagedSession,managedToSession}=await import('./packages/server-core/src/sessions/SessionManager.ts');
const {loadSession,listSessions}=await import('./packages/shared/src/sessions/storage.ts');
const {createTaskFromSpec}=await import('./packages/server-core/src/tasks/create-task.ts');
const {TaskRunner}=await import('./packages/server-core/src/tasks/TaskRunner.ts');
const {parseTaskSpec}=await import('./packages/shared/src/tasks/index.ts');
const root=join(realpathSync(process.env.ROX_CONFIG_DIR),'workspace');mkdirSync(root);
const workspace={id:'workspace-a',name:'Fixture',rootPath:root,createdAt:1};saveConfig({workspaces:[workspace],activeWorkspaceId:workspace.id,activeSessionId:null,
llmConnections:[{slug:'rox',name:'Synthetic OMP',providerType:'omp',authType:'none',defaultModel:'rox/standard',createdAt:1}]});
setSessionPlatform({appRootPath:process.cwd(),resourcesPath:process.cwd(),isPackaged:false,isDebugMode:false,logger:{info(){},warn(){},error(){},debug(){}}});
const service=new WorkspaceWorkService(new WorkspaceWorkStore(root,workspace.id),{members:()=>[{id:'owner',name:'Owner'}],hasMember:()=>true,hasProject:()=>false,hasSource:()=>false,hasSkill:()=>false,hasReference:()=>false});
const actor={actorId:'owner',canWrite:true,canDelete:true,canManage:true,assertCurrent(){}};
const profile=service.write(actor,{expectedRevision:0,kind:'createProfile',input:{name:'Reviewer',role:'Review only',sourceSlugs:[],skillSlugs:[],memoryScope:'none',automationEnabled:false}}).snapshot.profiles[0];
service.write(actor,{expectedRevision:1,kind:'setDefaultProfile',profileId:profile.id});
const sm=new SessionManager();const dialog=await sm.createSession(workspace.id,{name:'Bound'},{initialAssistantMessage:'Fixture greeting',emitCreatedEvent:false});
const assert=(condition,name)=>{if(!condition)throw Error(name)};const denied=async fn=>{let failed=false;try{await fn()}catch{failed=true}assert(failed,'expected denial')};
assert(dialog.agentProfileSnapshot.profileId===profile.id&&dialog.agentProfileSnapshot.role==='Review only','default profile not captured');
assert(dialog.memoryMode==='temporary'&&dialog.enabledSourceSlugs.length===0,'profile defaults missing');
await denied(()=>sm.setSessionSources(dialog.id,['outside']));await denied(()=>sm.sendMessage(dialog.id,'[skill:outside] Run this'));await denied(()=>sm.setSessionMemoryMode(dialog.id,'persistent'));
await sm.setSessionSources(dialog.id,[]);
service.write(actor,{expectedRevision:2,kind:'updateProfile',id:profile.id,patch:{role:'Changed role'}});
assert((await sm.getSession(dialog.id)).agentProfileSnapshot.role==='Review only','profile edit retargeted existing dialog');
const disk=loadSession(root,dialog.id);assert(disk.agentProfileSnapshot.role==='Review only'&&disk.agentProfileSnapshot.memoryScope==='none','snapshot not persisted');
const meta=listSessions(root).find(s=>s.id===dialog.id);const restored=createManagedSession(meta,workspace);assert(managedToSession(restored).agentProfileSnapshot.profileId===profile.id,'cold metadata lost snapshot');
const newer=await sm.createSession(workspace.id,{agentProfileId:profile.id},{initialAssistantMessage:'Fixture greeting',emitCreatedEvent:false});assert(newer.agentProfileSnapshot.role==='Changed role','new snapshot stale');
await denied(()=>sm.createSession(workspace.id,{agentProfileId:'unknown'},{initialAssistantMessage:'Fixture greeting'}));
const legacy=await sm.createSession(workspace.id,{name:'Legacy'},{initialAssistantMessage:'Fixture greeting',agentProfileSnapshot:null,emitCreatedEvent:false});assert(!legacy.agentProfileSnapshot,'unbound host dialog forced profile');
const wide=service.write(actor,{expectedRevision:3,kind:'createProfile',input:{name:'Wide default',role:'Wide workspace default',sourceSlugs:[],skillSlugs:[],memoryScope:'workspace',automationEnabled:true}}).snapshot.profiles.find(p=>p.id!==profile.id);
service.write(actor,{expectedRevision:4,kind:'setDefaultProfile',profileId:wide.id});
const branchSource=loadSession(root,dialog.id);
// Only the external provider handshake is offline. SessionManager still resolves
// the canonical source, captures its profile and persists the branched history.
const realGetOrCreateAgent=sm.getOrCreateAgent.bind(sm);let branchPreflight=false;
sm.getOrCreateAgent=async managed=>{assert(managed.agentProfileSnapshot.profileId===profile.id&&managed.agentProfileSnapshot.role==='Review only','provider received widened branch profile');managed.agent={ensureBranchReady:async()=>{branchPreflight=true}};return managed.agent};
const branch=await sm.createSession(workspace.id,{branchFromSessionId:dialog.id,branchFromMessageId:branchSource.messages[0].id},{initialAssistantMessage:'Fixture greeting',emitCreatedEvent:false});
sm.getOrCreateAgent=realGetOrCreateAgent;
assert(branchPreflight,'branch provider preflight was not exercised');
assert(branch.agentProfileSnapshot.profileId===profile.id&&branch.agentProfileSnapshot.role==='Review only'&&branch.memoryMode==='temporary','branch widened captured profile to new workspace default');
assert(loadSession(root,branch.id).agentProfileSnapshot.profileId===profile.id,'branch profile not persisted');
await denied(()=>sm.createSession(workspace.id,{parentSessionId:legacy.id,branchFromSessionId:dialog.id,branchFromMessageId:branchSource.messages[0].id},{initialAssistantMessage:'Fixture greeting'}));
const children=[];
const offlineHost={createSession:(id,options,internal)=>sm.createSession(id,options,{...internal,initialAssistantMessage:'Fixture greeting',emitCreatedEvent:false}),
setSessionSources:(...args)=>sm.setSessionSources(...args),applyTaskLabel:(...args)=>sm.applyTaskLabel(...args),
sendMessage:async id=>{children.push(await sm.getSession(id))},setSessionStatus:(...args)=>sm.setSessionStatus(...args),
setKanbanColumn:(...args)=>sm.setKanbanColumn(...args),setTaskNodeCount:(...args)=>sm.setTaskNodeCount(...args),
cancelProcessing:(...args)=>sm.cancelProcessing(...args),onSessionComplete:(...args)=>sm.onSessionComplete(...args),
getSessionFinalText:(...args)=>sm.getSessionFinalText(...args),getSessionWorkingDirectory:(...args)=>sm.getSessionWorkingDirectory(...args)};
const spec=parseTaskSpec({id:'captured-task',title:'Captured task',goal:'Fixture goal',defaults:{permissionMode:'safe'},nodes:[{id:'main',prompt:'Offline fixture'}]}).data;
const created=await createTaskFromSpec(offlineHost,workspace.id,root,spec,{agentProfileSnapshot:dialog.agentProfileSnapshot});
const orchestrator=await sm.getSession(created.orchestratorSessionId);
assert(orchestrator.agentProfileSnapshot.profileId===profile.id&&orchestrator.agentProfileSnapshot.role==='Review only','task orchestrator widened to workspace default');
const runner=new TaskRunner({host:offlineHost,workspaceId:workspace.id,workspaceRoot:root});
const run=runner.run(spec.id,{orchestratorSessionId:orchestrator.id,verifyOnComplete:false});
for(let i=0;i<200&&children.length===0;i++)await new Promise(r=>setTimeout(r,5));
assert(children.length===1,'Conductor child not dispatched');
assert(children[0].agentProfileSnapshot.profileId===profile.id&&children[0].memoryMode==='temporary'&&children[0].agentProfileSnapshot.role==='Review only','Conductor child widened to new default');
await denied(()=>sm.setSessionSources(children[0].id,['outside']));await denied(()=>sm.sendMessage(children[0].id,'[skill:outside] Run'));
await runner.stop(spec.id,run.runId);
await denied(()=>createTaskFromSpec(offlineHost,workspace.id,root,{...spec,id:'invalid-captured-task',skills:['outside']},{agentProfileSnapshot:dialog.agentProfileSnapshot}));
assert(!(await import('node:fs')).existsSync(join(root,'tasks','invalid-captured-task','task.yaml')),'denied spec was persisted');
const legacyChild=await sm.createSession(workspace.id,{parentSessionId:legacy.id},{initialAssistantMessage:'Fixture greeting',emitCreatedEvent:false});assert(!legacyChild.agentProfileSnapshot,'legacy descendant forced new workspace profile');
await denied(()=>sm.createSession(workspace.id,{parentSessionId:'unknown-parent'},{initialAssistantMessage:'Fixture greeting'}));
const exported=await sm.exportSession(dialog.id,workspace.id);
const forgedSnapshot={...wide,profileId:'forged-wide',workspaceId:'forged-workspace',role:'Forged role',sourceSlugs:['outside'],skillSlugs:['outside'],capturedAt:1};
const forgedCanonical={...exported,session:{...exported.session,header:{...exported.session.header,agentProfileSnapshot:forgedSnapshot}}};
const canonicalImport=await sm.importSession(workspace.id,forgedCanonical,'fork');
const trustedImported=await sm.getSession(canonicalImport.sessionId);
assert(trustedImported.agentProfileSnapshot.profileId===profile.id&&trustedImported.agentProfileSnapshot.role==='Review only'&&trustedImported.memoryMode==='temporary','canonical import lost captured profile');
assert(loadSession(root,canonicalImport.sessionId).agentProfileSnapshot.profileId===profile.id,'import snapshot not persisted');
const external={...forgedCanonical,session:{...forgedCanonical.session,header:{...forgedCanonical.session.header,id:'external-source',workspaceRootPath:'/external-workspace',enabledSourceSlugs:['outside']}}};
const externalImport=await sm.importSession(workspace.id,external,'fork');
const currentImported=await sm.getSession(externalImport.sessionId);
assert(currentImported.agentProfileSnapshot.profileId===wide.id&&currentImported.agentProfileSnapshot.role==='Wide workspace default','external import trusted claimed capabilities');
assert(currentImported.enabledSourceSlugs.length===0,'external import activated claimed outside sources');
await denied(()=>sm.sendMessage(currentImported.id,'[skill:outside] Run'));
const exportedLegacy=await sm.exportSession(legacy.id,workspace.id);
const legacyImport=await sm.importSession(workspace.id,{...exportedLegacy,session:{...exportedLegacy.session,header:{...exportedLegacy.session.header,agentProfileSnapshot:forgedSnapshot}}},'fork');
assert(!(await sm.getSession(legacyImport.sessionId)).agentProfileSnapshot,'canonical legacy import forced default profile');
await denied(()=>sm.importSession(workspace.id,{...external,session:{...external.session,header:{...external.session.header,id:'../outside'}}},'fork'));
await denied(()=>sm.importSession(workspace.id,{...external,files:[{relativePath:'./session.jsonl',contentBase64:Buffer.from('forged').toString('base64'),size:6}]},'fork'));
console.log('profile dialog snapshot persistence and ceiling passed');process.exit(0);
`], { cwd: join(import.meta.dir, '../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    expect(stdout).toContain('profile dialog snapshot persistence and ceiling passed')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 40000)
