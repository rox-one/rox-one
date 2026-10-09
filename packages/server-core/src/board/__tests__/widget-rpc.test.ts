import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Handler-level test over the REAL RPC surface: register the workspace-work and
 * board handlers on a WsRpcServer, drive them with a native client, and prove
 * `board:widgetPut` → `board:widgetMount` returns content whose bridge offset is
 * before the widget-code offset and that `board:changed` is pushed.
 */
test('the real board RPC surface wraps, mounts, releases and pushes board:changed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'board-rpc-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerWorkspaceWorkHandlers}=await import('./packages/server-core/src/handlers/rpc/workspace-work.ts');
const {registerBoardHandlers}=await import('./packages/server-core/src/handlers/rpc/board.ts');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const {WIDGET_BRIDGE_GLOBAL}=await import('./packages/shared/src/widgets/wrap.ts');
const root=realpathSync(process.env.ROX_CONFIG_DIR),aRoot=join(root,'a');mkdirSync(aRoot);
saveConfig({workspaces:[{id:'a',name:'A',rootPath:aRoot,createdAt:1}],activeWorkspaceId:'a',activeSessionId:null});
const authority=new NativeAuthority({stateDir:join(root,'authority')});
const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('Fixture operator')}
finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY')}
authority.registerWorkspace(admin.credential,'a',aRoot);
const enroll=name=>authority.redeemEnrollment(authority.issueEnrollment(admin.credential,name,Date.now()+60000),name);
const author=enroll('Author'),reader=enroll('Reader');
authority.grantWorkspace(admin.credential,author.principal.subject,'a',['read','write','delete','subscribe']);
authority.grantWorkspace(admin.credential,reader.principal.subject,'a',['read']);
let server;const clients=[];
const assert=(value,message)=>{if(!value)throw Error(message)};
const denied=async run=>{let failed=false;try{await run()}catch{failed=true}assert(failed,'expected denial')};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const start=async()=>{server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,
nativeEventChannels:new Set([RPC_CHANNELS.board.CHANGED])});
const deps={sessionManager:{getSessions:()=>[]},nativeData:{authority},platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
registerWorkspaceWorkHandlers(server,deps);registerBoardHandlers(server,deps);await server.listen()};
const connect=issued=>{const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId:'a',mode:'remote',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c};
const stop=async()=>{for(const c of clients.splice(0))c.destroy();await new Promise(r=>setTimeout(r,20));server.close()};
const B=RPC_CHANNELS.board;
try{await start();const a=connect(author),r=connect(reader);
const pushes=[];a.on(B.CHANGED,payload=>pushes.push(payload));
const widgetCode='<p id="widget-marker">hi</p>';
const put=await a.invoke(B.WIDGET_PUT,{workspaceId:'a',title:'Chart',widgetCode,kind:'html',name:'chart'});
assert(put.widgetId==='chart'&&put.name==='chart'&&put.revision===1,'widget put result');
for(let i=0;i<50&&pushes.length===0;i++)await sleep(20);
assert(pushes.length===1&&pushes[0].widgetId==='chart'&&pushes[0].revision===1,'board:changed push');
const mounted=await a.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'chart'});
assert(typeof mounted.ticket==='string'&&mounted.ticket.length>0&&mounted.revision===1,'widget mount ticket');
const bridgeAt=mounted.content.indexOf(WIDGET_BRIDGE_GLOBAL),codeAt=mounted.content.indexOf('widget-marker');
assert(bridgeAt>=0&&codeAt>bridgeAt,'bridge bytes precede widget code');
const got=await r.invoke(B.WIDGET_GET,{workspaceId:'a',widgetId:'chart'});
assert(got.revision===1&&got.content.indexOf('widget-marker')>got.content.indexOf(WIDGET_BRIDGE_GLOBAL),'widget get content');
const mountedByReader=await r.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'chart'});
assert(typeof mountedByReader.ticket==='string','reader may mount');
const released=await a.invoke(B.WIDGET_RELEASE,{workspaceId:'a',ticket:mounted.ticket});
assert(released.released===true,'widget release');
assert((await a.invoke(B.WIDGET_RELEASE,{workspaceId:'a',ticket:mounted.ticket})).released===false,'release idempotent');
await denied(()=>r.invoke(B.WIDGET_PUT,{workspaceId:'a',title:'X',widgetCode:'<b>x</b>',kind:'html',name:'nope'}));
// A2UI refusal travels the real surface as a typed error.
await denied(()=>a.invoke(B.WIDGET_PUT,{workspaceId:'a',title:'A2UI',kind:'a2ui',name:'a2ui',widgetCode:'{"version":"0.9","createSurface":{"surfaceId":"s","catalogId":"c"}}'}));
await denied(()=>a.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'missing'}));
await denied(()=>a.invoke(B.WIDGET_PUT,{workspaceId:'b',title:'X',widgetCode:'<b>x</b>',kind:'html',name:'nope'}));
console.log('board widget native RPC passed');
}finally{await stop();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'board widget native RPC passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20000)