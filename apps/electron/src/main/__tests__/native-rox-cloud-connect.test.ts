import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native desktop Rox Connect uses its own encrypted account and cannot log back in after logout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-cloud-connect-'))
  try {
    const proc = Bun.spawn([process.execPath, '-e', `
const {mkdirSync,readFileSync,existsSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {randomUUID}=await import('node:crypto');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerOnboardingHandlers}=await import('./apps/electron/src/main/onboarding.ts');
const {getCredentialManager}=await import('./packages/shared/src/credentials/manager.ts');
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
 registerOnboardingHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}},nativeData:{authority}});
 await server.listen();
};
const client=async(issued,local=true,workspaceId='workspace-a')=>{
 const proof=randomUUID();proofs.set(proof,{workspaceId,webContentsId:clients.length+1});
 const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId,webContentsId:clients.length+1,localClientProof:local?proof:undefined,mode:local?'local':'remote',autoReconnect:false,requestTimeout:2000,connectTimeout:2000});clients.push(c);c.connect();return c;
};
let devices=0;let approve=true;
globalThis.fetch=async(url,init)=>{
 const payload=JSON.parse(String(init?.body??'{}'));
 if(String(url).endsWith('/device/start'))return new Response(JSON.stringify({device_code:'synthetic-device-'+(++devices),user_code:'TEST-'+devices,verification_uri:'https://auth.example.test/device',expires_in:60,interval:2}),{status:200});
 if(String(url).endsWith('/device/poll'))return new Response(JSON.stringify(approve?{status:'approved',access_token:'synthetic-token-'+payload.device_code,expires_in:60,user:{id:payload.device_code,email:'synthetic@example.test',name:null}}:{status:'pending',interval:2}),{status:200});
 if(String(url).endsWith('/me/balance'))return new Response(JSON.stringify({balanceRox:'12.5'}),{status:200});
 throw new Error('Unexpected synthetic auth request');
};
const connected=async c=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const state=await c.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE);if(state.connected)return state;await new Promise(r=>setTimeout(r,5))}throw new Error('own cloud account did not connect')};
try{
 await start();const a=await client(author),b=await client(reader);
 const manager=getCredentialManager();await manager.setRoxCloudSession({accessToken:'synthetic-host-token',userId:'host-private-user',expiresAt:Date.now()+60000,authBaseUrl:'https://auth.example.test'});
 assert(!(await a.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected,'inherited host cloud account');
 const grant=await a.invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT);assert(grant.success&&grant.verificationUriComplete==='https://auth.example.test/device','device start failed or fallback link missing');
 const authorState=await connected(a);assert(authorState.user.id==='synthetic-device-1'&&!('accessToken'in authorState),'own account missing or raw token exposed');
 assert(!(await b.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected,'other actor inherited account');
 await b.invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT);assert((await connected(b)).user.id==='synthetic-device-2','reader account missing');
 assert((await a.invoke(RPC_CHANNELS.onboarding.GET_ROX_BALANCE)).balance===12.5,'own balance failed');
 await a.invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD);assert(!(await a.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected,'logout failed');
 assert((await b.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected,'logout cleared another actor');
 assert((await manager.getRoxCloudSession()).userId==='host-private-user','native login modified host credentials');
 const remote=await client(author,false);await denied(()=>remote.invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT));await denied(()=>remote.invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD));
 approve=false;await a.invoke(RPC_CHANNELS.onboarding.START_ROX_CONNECT);await a.invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD);approve=true;
 await new Promise(r=>setTimeout(r,50));assert(!(await a.invoke(RPC_CHANNELS.onboarding.GET_ROX_CLOUD_STATE)).connected,'late approval logged in after logout');
 assert(readFileSync(preferenceFile,'utf8')===hostBefore,'native cloud auth wrote host preferences');
 await b.invoke(RPC_CHANNELS.onboarding.CLEAR_ROX_CLOUD);
 console.log('native cloud connection isolation/cancellation passed');
}finally{for(const c of clients)c.destroy();await new Promise(resolve=>setTimeout(resolve,20));server?.close();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir, ROX_AUTH_BASE_URL: 'https://auth.example.test' }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'native cloud connection isolation/cancellation passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
