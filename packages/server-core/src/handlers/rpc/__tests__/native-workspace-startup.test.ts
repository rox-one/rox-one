import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native workspace startup projects only its authorized workspace without legacy window side effects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-workspace-startup-'))
  try {
    const proc = Bun.spawn([process.execPath, '-e', `
const {mkdirSync,readFileSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {createLocalClientBindingRegistry}=await import('./apps/electron/src/main/local-client-binding.ts');
const {registerWorkspaceCoreHandlers}=await import('./packages/server-core/src/handlers/rpc/workspace.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
const configDir=realpathSync(process.env.ROX_CONFIG_DIR);
const ownRoot=join(configDir,'workspace-a'),foreignRoot=join(configDir,'workspace-b');mkdirSync(ownRoot);mkdirSync(foreignRoot);
const own={id:'workspace-a',name:'Authorized Workspace',rootPath:ownRoot,createdAt:1,kind:'personal',remoteServer:{url:'https://private-own.invalid',token:'own-private-fixture-token',remoteWorkspaceId:'own-remote'}};
const foreign={id:'workspace-b',name:'PRIVATE FOREIGN ROSTER NAME',rootPath:foreignRoot,createdAt:2,kind:'personal',remoteServer:{url:'https://foreign.invalid',token:'foreign-private-fixture-token',remoteWorkspaceId:'foreign-remote'}};
saveConfig({workspaces:[own,foreign],activeWorkspaceId:'workspace-b',activeSessionId:null});
const hostBefore=readFileSync(join(configDir,'config.json'),'utf8');
const authority=new NativeAuthority({stateDir:join(configDir,'authority')});
const descriptor=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('fixture maintenance')}
finally{if(descriptor)Object.defineProperty(process.stdin,'isTTY',descriptor);else Reflect.deleteProperty(process.stdin,'isTTY')}
authority.registerWorkspace(admin.credential,own.id,ownRoot);authority.registerWorkspace(admin.credential,foreign.id,foreignRoot);
const issued=authority.redeemEnrollment(authority.issueEnrollment(admin.credential,'workspace startup reader',Date.now()+60000),'workspace startup reader');
authority.grantWorkspace(admin.credential,issued.principal.subject,own.id,['read']);
const registry=createLocalClientBindingRegistry(),renderer={};
const liveWindow={webContentsId:41,renderer,workspaceId:own.id};const proof=registry.issue(renderer);
let watcherCalls=0,windowWrites=0,routingWrites=0;
const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,validateToken:async token=>token==='fixture-legacy-session',resolveLocalClientBinding:candidate=>registry.resolve(candidate,id=>id===41?liveWindow:null)});
const originalUpdate=server.updateClientWorkspace.bind(server);
server.updateClientWorkspace=(...args)=>{routingWrites++;return originalUpdate(...args)};
const deps={nativeData:{authority},sessionManager:{getWorkspaces:()=>[own,foreign],setupConfigWatcher:()=>{watcherCalls++}},windowManager:{getWorkspaceForWindow:()=>own.id,updateWindowWorkspace:()=>{windowWrites++;return true},registerWindow:()=>{windowWrites++}},platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
registerWorkspaceCoreHandlers(server,deps);
const clients=[],checks=[];let legacyServer;
const check=(name,passed)=>checks.push({name,passed:!!passed});
const denied=async fn=>{try{await fn();return false}catch{return true}};
const client=(token=issued.credential,bound=true,workspaceId=own.id)=>{
 const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token,workspaceId,webContentsId:41,localClientProof:bound?proof:undefined,mode:'local',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c;
};
try{
 await server.listen();const native=client();
 const projection=await native.invoke(RPC_CHANNELS.workspaces.GET);
 check('own-workspace-only',projection.length===1&&projection[0].id===own.id);
 check('exact-public-metadata-keys',JSON.stringify(Object.keys(projection[0]).sort())===JSON.stringify(['createdAt','id','kind','name','rootPath','slug']));
 check('exact-authorized-metadata',JSON.stringify(projection[0])===JSON.stringify({id:own.id,name:own.name,slug:'workspace-a',rootPath:'',createdAt:1,kind:'personal'}));
 check('no-roster-or-connection-secret',!JSON.stringify(projection).includes('PRIVATE FOREIGN')&&!JSON.stringify(projection).includes('private-fixture-token')&&!JSON.stringify(projection).includes('remoteServer'));
 const spoofed=await native.invoke(RPC_CHANNELS.workspaces.GET,foreign.id,{workspaceId:foreign.id,principal:{subject:'forged'}});
 check('argument-spoof-cannot-select-another-workspace',JSON.stringify(spoofed)===JSON.stringify(projection));
 check('native-window-uses-authorized-context',(await native.invoke(RPC_CHANNELS.window.GET_WORKSPACE,foreign.id,{workspaceId:foreign.id}))===own.id);
 check('native-startup-has-zero-legacy-side-effects',watcherCalls===0&&windowWrites===0&&routingWrites===0);
 const unbound=client(issued.credential,false);
 check('unbound-window-workspace-denied',await denied(()=>unbound.invoke(RPC_CHANNELS.window.GET_WORKSPACE)));
 const reboundClient=client(issued.credential,true,foreign.id);
 check('main-binding-overrides-spoofed-handshake-workspace',JSON.stringify(await reboundClient.invoke(RPC_CHANNELS.workspaces.GET))===JSON.stringify(projection));
 const foreignClient=client(issued.credential,false,foreign.id);
 check('foreign-workspace-grant-denied',await denied(()=>foreignClient.invoke(RPC_CHANNELS.workspaces.GET)));
 authority.revokeCredential(admin.credential,issued.principal.credentialId);
 check('revoked-existing-client-roster-denied',await denied(()=>native.invoke(RPC_CHANNELS.workspaces.GET)));
 check('revoked-existing-client-window-denied',await denied(()=>native.invoke(RPC_CHANNELS.window.GET_WORKSPACE)));
 check('denials-still-have-zero-legacy-side-effects',watcherCalls===0&&windowWrites===0&&routingWrites===0);
 check('native-host-config-byte-preserved',readFileSync(join(configDir,'config.json'),'utf8')===hostBefore);
 // A registered native workspace correctly rejects legacy credentials on
 // this server. Verify the unchanged legacy deployment independently.
 check('legacy-cannot-enter-native-custody',await denied(()=>client('fixture-legacy-session').invoke(RPC_CHANNELS.workspaces.GET)));
 legacyServer=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async token=>token==='fixture-legacy-session',resolveLocalClientBinding:candidate=>registry.resolve(candidate,id=>id===41?liveWindow:null)});
 const originalLegacyUpdate=legacyServer.updateClientWorkspace.bind(legacyServer);
 legacyServer.updateClientWorkspace=(...args)=>{routingWrites++;return originalLegacyUpdate(...args)};
 registerWorkspaceCoreHandlers(legacyServer,deps);await legacyServer.listen();
 const legacy=new WsRpcClient('ws://127.0.0.1:'+legacyServer.port,{token:'fixture-legacy-session',workspaceId:own.id,webContentsId:41,localClientProof:proof,mode:'local',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(legacy);legacy.connect();
 check('normal-legacy-roster-still-works',(await legacy.invoke(RPC_CHANNELS.workspaces.GET)).length===2);
 check('normal-legacy-window-core-handler-still-works',(await legacy.invoke(RPC_CHANNELS.window.GET_WORKSPACE))===own.id&&watcherCalls===1&&routingWrites===1);
 console.log(JSON.stringify(checks));
}catch(error){throw Error(String(error?.message)+'; completed checks: '+checks.map(check=>check.name).join(', '))}
finally{for(const c of clients)c.destroy();await new Promise(resolve=>setTimeout(resolve,20));legacyServer?.close();server.close();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    const checks: Array<{ name: string; passed: boolean }> = JSON.parse(stdout)
    expect(checks).toHaveLength(17)
    expect(checks.filter(check => !check.passed)).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
