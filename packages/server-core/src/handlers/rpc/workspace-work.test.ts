import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('real native RPC enforces grants, actor ownership, scope, revisions and restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-work-rpc-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerWorkspaceWorkHandlers}=await import('./packages/server-core/src/handlers/rpc/workspace-work.ts');
const {registerSessionsHandlers}=await import('./packages/server-core/src/handlers/rpc/sessions.ts');
const {createProject}=await import('./packages/shared/src/projects/storage.ts');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const root=realpathSync(process.env.ROX_CONFIG_DIR),aRoot=join(root,'a'),bRoot=join(root,'b');mkdirSync(aRoot);mkdirSync(bRoot);
saveConfig({workspaces:[{id:'a',name:'A',rootPath:aRoot,createdAt:1},{id:'b',name:'B',rootPath:bRoot,createdAt:1}],activeWorkspaceId:'a',activeSessionId:null});
let authority=new NativeAuthority({stateDir:join(root,'authority')});
const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('Fixture operator')}
finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY')}
authority.registerWorkspace(admin.credential,'a',aRoot);authority.registerWorkspace(admin.credential,'b',bRoot);
const enroll=name=>authority.redeemEnrollment(authority.issueEnrollment(admin.credential,name,Date.now()+60000),name);
const author=enroll('Author'),assigned=enroll('Assigned'),other=enroll('Other'),reader=enroll('Reader'),manager=enroll('Manager');
for(const issued of [author,assigned,other])authority.grantWorkspace(admin.credential,issued.principal.subject,'a',['read','write','delete']);
authority.grantWorkspace(admin.credential,reader.principal.subject,'a',['read']);
authority.grantWorkspace(admin.credential,manager.principal.subject,'a',['read','write','delete','manage']);
let server;const clients=[];const capturedSessions=[];
const sessionManager={getSessions:ws=>capturedSessions.filter(session=>!ws||session.workspaceId===ws),
createSession:async(workspaceId,options,internal)=>{const session={...options,id:'native-fixture-session',workspaceId,messages:[],agentProfileSnapshot:internal.agentProfileSnapshot};capturedSessions.push(session);return session}};
const assert=(value,message)=>{if(!value)throw Error(message)};
const denied=async run=>{let failed=false;try{await run()}catch{failed=true}assert(failed,'expected denial')};
const start=async()=>{server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority});
const deps={sessionManager,nativeData:{authority},platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
registerWorkspaceWorkHandlers(server,deps);registerSessionsHandlers(server,deps);await server.listen()};
const connect=issued=>{const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId:'a',mode:'remote',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c};
const stop=async()=>{for(const c of clients.splice(0))c.destroy();await new Promise(r=>setTimeout(r,20));server.close()};
const W=RPC_CHANNELS.workspaceWork;
try{await start();let a=connect(author),b=connect(assigned),o=connect(other),r=connect(reader),m=connect(manager);
const initial=await a.invoke(W.READ,'a');assert(initial.revision===0&&initial.access.actorId===author.principal.subject,'actor binding');
assert(initial.members.length===5,'native workspace membership projection');
await denied(()=>a.invoke(W.READ,'b'));await denied(()=>r.invoke(W.WRITE,'a',{expectedRevision:0,kind:'createTask',input:{title:'Reader write'}}));
let saved=await a.invoke(W.WRITE,'a',{expectedRevision:0,kind:'createTask',input:{title:'Canonical',assigneeId:assigned.principal.subject}});
const id=saved.snapshot.tasks[0].id;assert(saved.snapshot.tasks[0].authorId===author.principal.subject&&saved.receipt.sha256.length===64,'canonical write receipt');
await denied(()=>o.invoke(W.WRITE,'a',{expectedRevision:1,kind:'updateTask',id,patch:{title:'Foreign edit'}}));
saved=await o.invoke(W.WRITE,'a',{expectedRevision:1,kind:'commentTask',taskId:id,text:'Member comment'});
saved=await b.invoke(W.WRITE,'a',{expectedRevision:2,kind:'updateTask',id,patch:{status:'in-progress'}});
await denied(()=>a.invoke(W.WRITE,'a',{expectedRevision:2,kind:'updateTask',id,patch:{title:'Stale'}}));
saved=await a.invoke(W.WRITE,'a',{expectedRevision:3,kind:'createProfile',input:{name:'Agent',role:'Review',sourceSlugs:[],skillSlugs:[]}});const profile=saved.snapshot.profiles[0];
await denied(()=>o.invoke(W.WRITE,'a',{expectedRevision:4,kind:'updateProfile',id:profile.id,patch:{role:'Other'}}));
await denied(()=>a.invoke(W.WRITE,'a',{expectedRevision:4,kind:'setDefaultProfile',profileId:profile.id}));
await m.invoke(W.WRITE,'a',{expectedRevision:4,kind:'setDefaultProfile',profileId:profile.id});
assert((await r.invoke(W.SNAPSHOT_PROFILE,'a')).profileId===profile.id,'default snapshot');
const project=createProject(aRoot,{name:'Canonical project'}),foreign=createProject(bRoot,{name:'Foreign project'});
const created=await a.invoke(RPC_CHANNELS.sessions.CREATE,'a',{projectId:project.id,systemPrompt:'Untrusted prompt',agentProfileSnapshot:{profileId:'forged'}});
assert(created.projectId===project.id&&created.agentProfileSnapshot.profileId===profile.id,'native project/profile projection lost');
assert(capturedSessions[0].workingDirectory==='none'&&capturedSessions[0].systemPrompt===undefined,'native whitelist widened host inputs');
await denied(()=>a.invoke(RPC_CHANNELS.sessions.CREATE,'a',{projectId:foreign.id}));
await denied(()=>a.invoke(RPC_CHANNELS.sessions.CREATE,'a',{projectId:'../outside'}));
await denied(()=>r.invoke(RPC_CHANNELS.sessions.CREATE,'a',{projectId:project.id}));
assert(capturedSessions.length===1,'invalid native session creation reached manager');
await stop();authority.close();authority=new NativeAuthority({stateDir:join(root,'authority')});await start();a=connect(author);
const restored=await a.invoke(W.READ,'a');assert(restored.tasks[0].id===id&&restored.defaultProfileId===profile.id&&restored.comments.length===1,'restart persistence');
authority.revokeWorkspaceGrant(admin.credential,author.principal.subject,'a');await denied(()=>a.invoke(W.READ,'a'));
console.log('workspace work native ACL and persistence passed');
}finally{await stop();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'workspace work native ACL and persistence passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20000)
