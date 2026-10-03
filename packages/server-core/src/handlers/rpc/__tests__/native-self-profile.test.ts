import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('real native WS self profiles isolate actors, persist restart and reject foreign/revoked/spoofed authority without host preference writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-self-profile-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,readFileSync,existsSync,realpathSync}=await import('node:fs');
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
let server;
const start=async()=>{
 server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,validateToken:async token=>token==='fixture-legacy-token',resolveLocalClientBinding:candidate=>proofs.get(candidate.localClientProof)??null});
 registerOrgsHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},nativeData:{authority}});
 await server.listen();
};
const client=async(issued,local=true,workspaceId='workspace-a')=>{
 const proof=randomUUID();proofs.set(proof,{workspaceId,webContentsId:clients.length+1});
 const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId,webContentsId:clients.length+1,localClientProof:local?proof:undefined,mode:local?'local':'remote',autoReconnect:false,requestTimeout:500,connectTimeout:500});clients.push(c);c.connect();return c;
};
try{
 await start();const a=await client(author),b=await client(reader);
 const initial=await a.invoke(RPC_CHANNELS.orgs.GET_IDENTITY);assert(initial.userId===author.principal.subject&&initial.authority==='native'&&initial.name===undefined&&!('username'in initial),'host profile leaked');
 const saved=await a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'  Alice   Native  ',userId:reader.principal.subject,issuer:'forged',email:'spoof@example.com'});
 assert(saved.name==='Alice Native'&&saved.userId===author.principal.subject&&!('email'in saved),'profile update spoofed identity');
 assert((await b.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name===undefined,'other actor saw author profile');
 await b.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{username:'Reader'});
 assert((await a.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Native','reader overwrote author');
 await denied(()=>a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:' '.repeat(5)}));
 await denied(()=>a.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'x'.repeat(101)}));
 const remote=await client(author,false);await denied(()=>remote.invoke(RPC_CHANNELS.orgs.UPDATE_IDENTITY,{name:'remote'}));
 await denied(()=>remote.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));
 const live=authority.authenticate(author.credential);await denied(()=>Promise.resolve(authority.getSelfProfile({...live},'workspace-a')));
 await denied(()=>Promise.resolve(authority.getSelfProfile(live,'workspace-b')));
 assert(readFileSync(preferenceFile,'utf8')===hostBefore,'native self update wrote host preferences');
 for(const c of clients.splice(0))c.destroy();await new Promise(resolve=>setTimeout(resolve,20));server.close();authority.close();
 authority=new NativeAuthority({stateDir:state});await start();const restarted=await client(author);
 assert((await restarted.invoke(RPC_CHANNELS.orgs.GET_IDENTITY)).name==='Alice Native','profile lost restart');
 authority.revokeCredential(admin.credential,author.principal.credentialId);
 const revokedClient=await client(author); await denied(()=>revokedClient.invoke(RPC_CHANNELS.orgs.GET_IDENTITY));
 await denied(()=>Promise.resolve(authority.updateSelfProfile(live,'workspace-a',{name:'revoked'})));
 console.log('native self profile isolation/persistence/denials passed');
}finally{for(const c of clients)c.destroy();await new Promise(resolve=>setTimeout(resolve,20));server?.close();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'native self profile isolation/persistence/denials passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
