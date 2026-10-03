import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native startup summary is configuration-only and scoped to authenticated workspace reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-startup-runtime-'))
  try {
    const proc = Bun.spawn([process.execPath, '-e', `
const {mkdirSync,readFileSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {createLocalClientBindingRegistry}=await import('./apps/electron/src/main/local-client-binding.ts');
const {registerLlmConnectionsHandlers}=await import('./packages/server-core/src/handlers/rpc/llm-connections.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {saveConfig,addLlmConnection,setDefaultLlmConnection}=await import('./packages/shared/src/config/storage.ts');
const {getCredentialManager}=await import('./packages/shared/src/credentials/index.ts');
const configDir=realpathSync(process.env.CRAFT_CONFIG_DIR);
saveConfig({workspaces:[{id:'workspace-a',slug:'workspace-a',name:'Fixture',rootPath:join(configDir,'workspace'),createdAt:1}],activeWorkspaceId:'workspace-a',activeSessionId:null,llmConnections:[]});
if(!addLlmConnection({slug:'fixture-default',name:'PRIVATE ACCOUNT DISPLAY',providerType:'anthropic',authType:'oauth',baseUrl:'https://private-account.invalid/secret-path',defaultModel:'private-model',createdAt:1}))throw Error('fixture config unavailable');
setDefaultLlmConnection('fixture-default');
const configPath=join(configDir,'config.json');const hostBefore=readFileSync(configPath,'utf8');
let credentialCalls=0,networkCalls=0;
const manager=getCredentialManager();
for(const name of ['get','inspect','set','delete','getLlmOAuth','getClaudeOAuthCredentials','setLlmOAuth','hasLlmCredentials','getLlmApiKey'])manager[name]=async()=>{credentialCalls++;throw Error('summary touched credentials')};
globalThis.fetch=async()=>{networkCalls++;throw Error('summary touched OAuth/network')};
const authority=new NativeAuthority({stateDir:join(configDir,'authority')});
const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('fixture operator')}
finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY')}
const root=join(configDir,'workspace');mkdirSync(root,{recursive:true});authority.registerWorkspace(admin.credential,'workspace-a',root);
const foreignRoot=join(configDir,'foreign');mkdirSync(foreignRoot);authority.registerWorkspace(admin.credential,'workspace-b',foreignRoot);
const issued=authority.redeemEnrollment(authority.issueEnrollment(admin.credential,'fixture-device',Date.now()+60000),'fixture-device');
authority.grantWorkspace(admin.credential,issued.principal.subject,'workspace-a',['read','subscribe']);
const registry=createLocalClientBindingRegistry(),renderer={},replacementRenderer={};
let liveWindow={webContentsId:41,renderer,workspaceId:'workspace-a'};
const proof=registry.issue(renderer),clients=[];
const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,nativeEventChannels:new Set(['fixture:startup-event']),validateToken:async token=>token==='fixture-legacy-session',resolveLocalClientBinding:candidate=>registry.resolve(candidate,id=>liveWindow?.webContentsId===id?liveWindow:null)});
// Preserve the real registered handler and transport options. A one-shot pause
// after its result is computed exposes the actual transport response fence.
let responsePause=null;
const register=server.handle.bind(server);
server.handle=(channel,handler,options)=>register(channel,channel===RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY
 ? async(...args)=>{const result=await handler(...args);const pause=responsePause;if(pause){responsePause=null;pause.entered();await pause.released}return result}
 : handler,options);
const checks=[];
const check=(name,passed)=>checks.push({name,passed:!!passed});
const isDenied=async fn=>{try{await fn();return false}catch{return true}};
const client=(token=issued.credential,localProof=proof,workspaceId='workspace-a',capabilities=[])=>{
 const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token,workspaceId,webContentsId:41,localClientProof:localProof,mode:'local',autoReconnect:false,clientCapabilities:capabilities,requestTimeout:500,connectTimeout:500});clients.push(c);c.connect();return c;
};
try{
 registerLlmConnectionsHandlers(server,{nativeData:{authority},sessionManager:{},platform:{logger:{info(){},warn(){},error(){},debug(){}}}});await server.listen();
 const valid=client();const summary=await valid.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY);
 check('exact-six-safe-keys',JSON.stringify(Object.keys(summary).sort())===JSON.stringify(['defaultModel','isDefault','kind','models','providerType','slug']));
 check('configuration-only-default',summary.kind==='configuration-only'&&summary.slug==='fixture-default'&&summary.providerType==='anthropic'&&summary.isDefault===true&&Array.isArray(summary.models)&&summary.models.some(model=>model.id===summary.defaultModel)&&!JSON.stringify(summary).includes('PRIVATE ACCOUNT DISPLAY')&&!JSON.stringify(summary).includes('secret-path'));
 const unboundLegacy=client('fixture-legacy-session','');check('unbound-legacy-summary-denied',await isDenied(()=>unboundLegacy.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 check('no-credential-or-oauth-calls',credentialCalls===0&&networkCalls===0);
 check('zero-host-config-writes',readFileSync(configPath,'utf8')===hostBefore);
 const events=[];valid.on('fixture:startup-event',event=>events.push(event));
 server.push('fixture:startup-event',{to:'workspace',workspaceId:'workspace-a'},{revision:1});
 await valid.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY);
 check('current-bound-native-event-delivery',JSON.stringify(events)===JSON.stringify([{revision:1}]));
 const spoof=client(issued.credential,'fake-main-proof');check('native-read-does-not-need-local-proof',(await spoof.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug==='fixture-default');
 const capability=client(issued.credential,'','workspace-a',['client:openFileDialog']);check('native-read-with-only-read-grant',(await capability.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug==='fixture-default');
 liveWindow={webContentsId:41,renderer,workspaceId:'workspace-b'};
 const foreign=client();check('foreign-live-window-workspace-denied',await isDenied(()=>foreign.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 server.push('fixture:startup-event',{to:'workspace',workspaceId:'workspace-a'},{revision:2});
 check('existing-client-window-switch-denied',await isDenied(()=>valid.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 check('window-switch-suppresses-native-event',JSON.stringify(events)===JSON.stringify([{revision:1}]));
 liveWindow={webContentsId:41,renderer:replacementRenderer,workspaceId:'workspace-a'};
 const staleProof=client();check('read-grant-remains-authority-without-local-proof',(await staleProof.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug==='fixture-default');
 server.push('fixture:startup-event',{to:'workspace',workspaceId:'workspace-a'},{revision:3});
 check('existing-client-renderer-replacement-denied',await isDenied(()=>valid.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 check('renderer-replacement-suppresses-native-event',JSON.stringify(events)===JSON.stringify([{revision:1}]));
 liveWindow=null;
 server.push('fixture:startup-event',{to:'workspace',workspaceId:'workspace-a'},{revision:4});
 check('existing-client-destroyed-window-denied',await isDenied(()=>valid.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 check('destroyed-window-suppresses-native-event',JSON.stringify(events)===JSON.stringify([{revision:1}]));
 liveWindow={webContentsId:41,renderer,workspaceId:'workspace-a'};
 for(const [name,nextWindow] of [
  ['post-await-workspace-switch-denied',{webContentsId:41,renderer,workspaceId:'workspace-b'}],
  ['post-await-renderer-replacement-denied',{webContentsId:41,renderer:replacementRenderer,workspaceId:'workspace-a'}],
  ['post-await-window-destroyed-denied',null],
 ]){
  liveWindow={webContentsId:41,renderer,workspaceId:'workspace-a'};
  const deferredClient=client();
  await deferredClient.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY);
  let entered,release;
  const reached=new Promise(resolve=>{entered=resolve});
  const released=new Promise(resolve=>{release=resolve});
  responsePause={entered,released};
  const outcome=deferredClient.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY).then(()=>false,()=>true);
  await reached;
  liveWindow=nextWindow;release();
  check(name,await outcome);
 }
 liveWindow={webContentsId:41,renderer,workspaceId:'workspace-a'};
 const currentLocal=client();
 check('normal-current-local-call-remains-valid',(await currentLocal.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)).slug==='fixture-default');
 authority.revokeCredential(admin.credential,issued.principal.credentialId);
 const revoked=client();check('revoked-credential-denied',await isDenied(()=>revoked.invoke(RPC_CHANNELS.llmConnections.GET_STARTUP_SUMMARY)));
 check('all-denials-still-zero-credential-network-host-writes',credentialCalls===0&&networkCalls===0&&readFileSync(configPath,'utf8')===hostBefore);
 console.log(JSON.stringify(checks));
}finally{for(const c of clients)c.destroy();await new Promise(resolve=>setTimeout(resolve,20));server.close();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, CRAFT_CONFIG_DIR: dir, ROX_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const checks: Array<{ name: string; passed: boolean }> = JSON.parse(stdout)
    expect(checks).toHaveLength(22)
    expect(checks.filter(check => !check.passed)).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
