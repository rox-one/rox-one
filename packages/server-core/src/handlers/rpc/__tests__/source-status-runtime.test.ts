import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('source index status is registered, workspace-bound, and unavailable to native principals', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'source-status-runtime-'))
 try {
  const child = Bun.spawn([process.execPath, '-e', `
const {mkdirSync,writeFileSync,readFileSync,realpathSync}=await import('node:fs');const {join}=await import('node:path');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerSourcesHandlers}=await import('./packages/server-core/src/handlers/rpc/sources.ts');const {createLocalClientBindingRegistry}=await import('./apps/electron/src/main/local-client-binding.ts');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');const {saveConfig}=await import('./packages/shared/src/config/storage.ts');const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {reindexWorkspaceSources,closeAllSourceIndexes}=await import('./packages/server-core/src/sources/source-index.ts');
const root=realpathSync(process.env.ROX_CONFIG_DIR),ownRoot=join(root,'own'),foreignRoot=join(root,'foreign');mkdirSync(ownRoot);mkdirSync(foreignRoot);
const own={id:'own',name:'Own',rootPath:ownRoot,createdAt:1},foreign={id:'foreign',name:'Foreign',rootPath:foreignRoot,createdAt:1};saveConfig({workspaces:[own,foreign],activeWorkspaceId:own.id,activeSessionId:null});
const files=join(root,'source-files');mkdirSync(files);writeFileSync(join(files,'note.md'),'fixture indexed content');reindexWorkspaceSources(ownRoot,[{slug:'fixture',path:files}]);closeAllSourceIndexes();
const {getWorkspaceByNameOrId}=await import('./packages/shared/src/config/index.ts');getWorkspaceByNameOrId(own.id);
const configBefore=readFileSync(join(root,'config.json'),'utf8');
const registry=createLocalClientBindingRegistry(),renderer={};let window={webContentsId:41,renderer,workspaceId:own.id};const proof=registry.issue(renderer);
const deps={platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
const server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,validateToken:async t=>t==='local-fixture',resolveLocalClientBinding:c=>registry.resolve(c,id=>id===41?window:null)});registerSourcesHandlers(server,deps);await server.listen();
const clients=[],checks=[];const check=(name,passed)=>{if(!passed)throw Error(name);checks.push(name)};const denied=async f=>{try{await f();return false}catch{return true}};
function client(s,token='local-fixture',workspaceId=own.id,bound=true){const c=new WsRpcClient('ws://127.0.0.1:'+s.port,{token,workspaceId,webContentsId:41,localClientProof:bound?proof:undefined,mode:'local',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c;}
let nativeServer,authority;
try {
 const local=client(server);const status=await local.invoke(RPC_CHANNELS.sources.STATUS,own.id);
 check('actual indexed file count',status.indexed===1);check('truthful existing engine',status.primary==='ts');
 check('host config preserved',readFileSync(join(root,'config.json'),'utf8')===configBefore);
 check('wrong workspace denied',await denied(()=>local.invoke(RPC_CHANNELS.sources.STATUS,foreign.id)));
 check('missing workspace denied',await denied(()=>local.invoke(RPC_CHANNELS.sources.STATUS,'missing')));
 check('unbound caller denied',await denied(()=>client(server,'local-fixture',own.id,false).invoke(RPC_CHANNELS.sources.STATUS,own.id)));
 window={...window,workspaceId:foreign.id};check('stale window denied',await denied(()=>local.invoke(RPC_CHANNELS.sources.STATUS,own.id)));window={...window,workspaceId:own.id};
 authority=new NativeAuthority({stateDir:join(root,'authority')});const descriptor=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
 try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('test fixture maintenance')}finally{if(descriptor)Object.defineProperty(process.stdin,'isTTY',descriptor);else Reflect.deleteProperty(process.stdin,'isTTY')}
 authority.registerWorkspace(admin.credential,own.id,ownRoot);const enrolled=authority.redeemEnrollment(authority.issueEnrollment(admin.credential,'source status reader',Date.now()+60000),'source status reader');authority.grantWorkspace(admin.credential,enrolled.principal.subject,own.id,['read']);
 nativeServer=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,resolveLocalClientBinding:c=>registry.resolve(c,id=>id===41?window:null)});registerSourcesHandlers(nativeServer,deps);await nativeServer.listen();
 const native=client(nativeServer,enrolled.credential);check('native read grant cannot read host source status',await denied(()=>native.invoke(RPC_CHANNELS.sources.STATUS,own.id)));
 authority.revokeWorkspaceGrant(admin.credential,enrolled.principal.subject,own.id);check('revoked native remains denied',await denied(()=>native.invoke(RPC_CHANNELS.sources.STATUS,own.id)));
 console.log(JSON.stringify(checks));
}finally{for(const c of clients)c.destroy();await Bun.sleep(20);server.close();nativeServer?.close();authority?.close();closeAllSourceIndexes();}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir, CRAFT_FEATURE_NATIVE_SIDECAR: '0', CRAFT_FEATURE_NATIVE_INDEX_PRIMARY: '0' }, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
  expect(JSON.parse(stdout)).toHaveLength(9)
 } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
