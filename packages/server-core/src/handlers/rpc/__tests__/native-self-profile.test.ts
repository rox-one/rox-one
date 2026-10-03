import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real native WS self profiles work without desktop proof, isolate actors, persist restart and reject legacy/foreign/revoked authority', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-self-profile-'))
  try {
    const proc = Bun.spawn([process.execPath, '-e', `
const {mkdirSync,readFileSync,existsSync,realpathSync,renameSync,rmSync}=await import('node:fs');
const {join}=await import('node:path');
const {randomUUID}=await import('node:crypto');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerOrgsHandlers}=await import('./packages/server-core/src/handlers/rpc/orgs.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {updatePreferences,ensureLocalUserIdentity,getPreferencesPath}=await import('./packages/shared/src/config/preferences.ts');
const assert=(value,message)=>{if(!value)throw Error(message)};
const denied=async fn=>{let rejected=false;try{await fn()}catch{rejected=true}assert(rejected,'expected denial')};
const state=join(process.env.CRAFT_CONFIG_DIR,'state');
let authority=new NativeAuthority({stateDir:state});
const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('fixture operator')}
finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY')}
const root=join(realpathSync(process.env.CRAFT_CONFIG_DIR),'workspace');mkdirSync(root);
authority.registerWorkspace(admin.credential,'workspace-a',root);
const foreignRoot=join(realpathSync(process.env.CRAFT_CONFIG_DIR),'foreign');mkdirSync(foreignRoot);
authority.registerWorkspace(admin.credential,'workspace-b',foreignRoot);
const enroll=label=>authority.redeemEnrollment(authority.issueEnrollment(admin.credential,label,Date.now()+60000),label);
const author=enroll('author'),reader=enroll('reader');
for(const issued of [author,reader])authority.grantWorkspace(admin.credential,issued.principal.subject,'workspace-a',['read']);
ensureLocalUserIdentity();updatePreferences({name:'HOST PRIVATE NAME',username:'HOST PRIVATE USER'});
const preferenceFile=join(process.env.CRAFT_CONFIG_DIR,'preferences.json');
const hostBefore=readFileSync(preferenceFile,'utf8');
const proofs=new Map(); const clients=[];
let server,legacyServer,responsePause=null;
const start=async()=>{
 server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,validateToken:async token=>token==='fixture-legacy-token',resolveLocalClientBinding:candidate=>proofs.get(candidate.localClientProof)??null});
 const handle=server.handle.bind(server);
 server.handle=(channel,handler,options)=>handle(channel,channel===RPC_CHANNELS.orgs.GET_IDENTITY
  ?async(...args)=>{const result=await handler(...args);const pause=responsePause;if(pause){responsePause=null;pause.entered();await pause.released}return result}
  :handler,options);
 registerOrgsHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},nativeData:{authority}});
 await server.listen();
};
const client=async(issued,local=true,workspaceId='workspace-a',capabilities=[])=>{
 const proof=randomUUID();proofs.set(proof,{workspaceId,webContentsId:clients.length+1});
 const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId,webContentsId:clients.length+1,localClientProof:local?proof:undefined,mode:local?'local':'remote',clientCapabilities:capabilities,autoReconnect:false,requestTimeout:500,connectTimeout:500});clients.push(c);c.connect();return c;
};
let stage='local self profile';try{
 await start();const a=await client(author),b=await client(reader);
 const initial=await a.invoke(RPC_CHANNELS.orgs.GET_IDENTITY);assert(initial.userId===author.principal.subject&&initial.authority==='native'&&initial.name===undefined&&!('username'in initial),'host profile leaked');
 const saved=await a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'  Alice   Native  ',userId:reader.principal.subject,issuer:'forged',email:'spoof@example.com'});
 assert(saved.name==='Alice Native'&&saved.userId===author.principal.subject&&!('email'in saved),'profile update spoofed identity');
 assert((await b.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name===undefined,'other actor saw author profile');
 await b.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{username:'Reader'});
 assert((await a.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Native','reader overwrote author');
 await denied(()=>a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:' '.repeat(5)}));
 await denied(()=>a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'x'.repeat(101)}));
 stage='thin self profile';let remote=await client(author,false);
 assert((await remote.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Native','thin client cannot read its native profile');
 const thinSaved=await remote.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'Alice Thin',email:'foreign@example.com',userId:reader.principal.subject});
 assert(thinSaved.name==='Alice Thin'&&thinSaved.userId===author.principal.subject&&thinSaved.authority==='native'&&!('email'in thinSaved),'thin profile update escaped authenticated actor');
 assert((await a.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Thin','thin update did not persist to native authority');
 assert((await b.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Reader','thin update changed other actor');
 stage='legacy denial';const legacy=await client({credential:'fixture-legacy-token'},false);
 await denied(()=>legacy.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>legacy.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'legacy spoof'}));
 const advertised=await client({credential:'fixture-legacy-token'},false,'workspace-a',['client:openFileDialog']);
 await denied(()=>advertised.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>advertised.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'capability spoof'}));
 stage='legacy transport';legacyServer=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token=>token==='fixture-legacy-token',resolveLocalClientBinding:candidate=>proofs.get(candidate.localClientProof)??null});
 registerOrgsHandlers(legacyServer,{platform:{logger:{info(){},warn(){},error(){},debug(){}}}});await legacyServer.listen();
 const legacyClient=(proof,capabilities=[])=>{const c=new WsRpcClient('ws://127.0.0.1:'+legacyServer.port,{token:'fixture-legacy-token',workspaceId:'workspace-a',webContentsId:777,localClientProof:proof,mode:proof?'local':'remote',clientCapabilities:capabilities,autoReconnect:false,requestTimeout:500,connectTimeout:500});clients.push(c);c.connect();return c};
 const unboundLegacy=legacyClient();await denied(()=>unboundLegacy.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>unboundLegacy.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'unbound'}));
 const spoofLocal=legacyClient(undefined,['client:openFileDialog']);
 for(const channel of [RPC_CHANNELS.orgs.GET_IDENTITY,RPC_CHANNELS.orgs.UPDATE_IDENTITY,RPC_CHANNELS.orgs.LIST,RPC_CHANNELS.orgs.CREATE,RPC_CHANNELS.orgs.SET_WORKSPACE_ORG])await denied(()=>spoofLocal.invoke(channel,{name:'capability spoof'}));
 proofs.set('fixture-main-proof',{workspaceId:'workspace-a',webContentsId:777});const trustedLocal=legacyClient('fixture-main-proof');
 assert((await trustedLocal.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).authority==='local','trusted legacy desktop identity regressed');
 stage='foreign grant';const foreign=await client(author,false,'workspace-b');await denied(()=>foreign.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>foreign.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'foreign'}));
 for(const channel of [RPC_CHANNELS.orgs.CREATE,RPC_CHANNELS.orgs.INVITE,RPC_CHANNELS.orgs.SET_WORKSPACE_ORG])await denied(()=>remote.invoke(channel,{name:'host mutation'}));
 stage='grant revoked';authority.revokeWorkspaceGrant(admin.credential,author.principal.subject,'workspace-a');
 await denied(()=>remote.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>remote.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'no read grant'}));
 stage='grant restored';authority.grantWorkspace(admin.credential,author.principal.subject,'workspace-a',['read']);
 remote=await client(author,false);
 assert((await remote.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Thin','read grant restore failed');
 stage='root replaced';renameSync(root,root+'-original');mkdirSync(root);
 await denied(()=>remote.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));await denied(()=>remote.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'replaced root'}));
 rmSync(root,{recursive:true});renameSync(root+'-original',root);
 stage='direct authority';const live=authority.authenticate(author.credential);await denied(()=>Promise.resolve(authority.getSelfProfile({...live},'workspace-a')));
 await denied(()=>Promise.resolve(authority.getSelfProfile(live,'workspace-b')));
 assert(readFileSync(preferenceFile,'utf8')===hostBefore,'native self update wrote host preferences');
 for(const c of clients.splice(0))c.destroy();await new Promise(resolve=>setTimeout(resolve,20));server.close();authority.close();
 stage='restart';authority=new NativeAuthority({stateDir:state});await start();const restarted=await client(author);
 assert((await restarted.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Thin','profile lost restart');
 const restartedThin=await client(author,false);assert((await restartedThin.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Thin','thin profile lost restart');
 stage='inflight revocation';let entered,release;const reached=new Promise(resolve=>{entered=resolve});const released=new Promise(resolve=>{release=resolve});responsePause={entered,released};
 const late=restartedThin.invoke(RPC_CHANNELS.orgs.GET_IDENTITY).then(()=>false,()=>true);await reached;
 authority.revokeCredential(admin.credential,author.principal.credentialId);
 release();assert(await late,'revoked in-flight thin profile response returned');
 const revokedClient=await client(author); await denied(()=>revokedClient.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));
 await denied(()=>Promise.resolve(authority.updateSelfProfile(live,'workspace-a',{name:'revoked'})));
 console.log('native self profile isolation/persistence/denials passed');
}catch(error){throw Error(stage+': '+error.message)}finally{for(const c of clients)c.destroy();await new Promise(resolve=>setTimeout(resolve,20));legacyServer?.close();server?.close();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'native self profile isolation/persistence/denials passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
