import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Handler-level proof that the widget VIEW TICKET is enforceable over the wire
 * (runtime verification V19 found no production path ever called
 * `tickets.validate`). Drives the REAL `board:widgetValidate` RPC on a
 * WsRpcServer with a native client and asserts the full refusal matrix is
 * reachable and uniform:
 *
 *   mount -> validate ok; re-put -> the same nonce is refused; a forged nonce is
 *   refused identically; an expired ticket (short TTL seeded into the
 *   per-workspace registry) is refused; release -> refused.
 *
 * Every refusal must be the ONE typed `WIDGET_TICKET_REFUSED` with a constant
 * message, and success must never echo ticket material back to the caller.
 */
test('board:widgetValidate enforces the view ticket over the real RPC surface', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'board-ticket-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerWorkspaceWorkHandlers}=await import('./packages/server-core/src/handlers/rpc/workspace-work.ts');
const {registerBoardHandlers}=await import('./packages/server-core/src/handlers/rpc/board.ts');
const {saveConfig,getWorkspaceByNameOrId}=await import('./packages/shared/src/config/storage.ts');
const {widgetTicketRegistryFor}=await import('./packages/server-core/src/board/widget-tickets.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const root=realpathSync(process.env.ROX_CONFIG_DIR),aRoot=join(root,'a');mkdirSync(aRoot);
saveConfig({workspaces:[{id:'a',name:'A',rootPath:aRoot,createdAt:1}],activeWorkspaceId:'a',activeSessionId:null});
// Deterministic clock: the registry reads its TTL from the injected clock, so
// expiry advances instantly without any real wall-clock wait.
let clock=Date.now();
const assert=(value,message)=>{if(!value)throw Error(message)};
const workspace=getWorkspaceByNameOrId('a');
assert(workspace,'workspace resolved');
widgetTicketRegistryFor(workspace.rootPath,{leaseTtlMs:1000,now:()=>clock});
const authority=new NativeAuthority({stateDir:join(root,'authority')});
const tty=Object.getOwnPropertyDescriptor(process.stdin,'isTTY');let admin;
try{Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});admin=authority.bootstrapLocalAdministrator('Fixture operator')}
finally{if(tty)Object.defineProperty(process.stdin,'isTTY',tty);else Reflect.deleteProperty(process.stdin,'isTTY')}
authority.registerWorkspace(admin.credential,'a',aRoot);
const enroll=name=>authority.redeemEnrollment(authority.issueEnrollment(admin.credential,name,Date.now()+60000),name);
const author=enroll('Author');
authority.grantWorkspace(admin.credential,author.principal.subject,'a',['read','write','delete','subscribe']);
let server;const clients=[];
// Rejected ticket -> the uniform typed refusal; returns the exact code+message.
const refusal=async run=>{try{await run()}catch(error){return {code:error&&error.code,message:error&&error.message}}throw Error('expected the ticket to be refused')};
const start=async()=>{server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,
nativeEventChannels:new Set([RPC_CHANNELS.board.CHANGED])});
const deps={sessionManager:{getSessions:()=>[]},nativeData:{authority},platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
registerWorkspaceWorkHandlers(server,deps);registerBoardHandlers(server,deps);await server.listen()};
const connect=issued=>{const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId:'a',mode:'remote',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c};
const stop=async()=>{for(const c of clients.splice(0))c.destroy();await new Promise(r=>setTimeout(r,20));server.close()};
const B=RPC_CHANNELS.board;
try{await start();const a=connect(author);
const widgetCode='<p id="widget-marker">hi</p>';
await a.invoke(B.WIDGET_PUT,{workspaceId:'a',title:'Chart',widgetCode,kind:'html',name:'chart'});
const mounted=await a.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'chart'});
assert(mounted.revision===1&&typeof mounted.ticket==='string'&&mounted.ticket.length>0,'mount returns a ticket');
// A freshly mounted ticket validates and discloses nothing but its expiry.
const ok=await a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:mounted.ticket,revision:1});
assert(ok.valid===true&&typeof ok.expiresAt==='number'&&ok.expiresAt>clock,'validate returns valid+expiresAt');
assert(Object.keys(ok).sort().join(',')==='expiresAt,valid','validate response carries no ticket material');
// A re-put advances the revision and rotates the generation: the old nonce dies.
await a.invoke(B.WIDGET_PUT,{workspaceId:'a',title:'Chart',widgetCode,kind:'html',name:'chart'});
const staleByDefault=await refusal(()=>a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:mounted.ticket}));
const staleByRevision=await refusal(()=>a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:mounted.ticket,revision:1}));
// A forged nonce is refused identically — no reason and no ticket data leak.
const forged=await refusal(()=>a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:'deadbeefdeadbeefdeadbeefdeadbeef'}));
assert(staleByDefault.code==='WIDGET_TICKET_REFUSED','stale ticket refused with the typed code');
assert(JSON.stringify(staleByDefault)===JSON.stringify(staleByRevision),'stale refusal is identical with or without the revision');
assert(JSON.stringify(forged)===JSON.stringify(staleByDefault),'forged refusal is indistinguishable from stale');
// An expired ticket (TTL on the seeded clock) is refused through the same path.
const expiring=await a.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'chart'});
assert(expiring.revision===2,'remount after re-put sees revision 2');
clock+=2000;
const expired=await refusal(()=>a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:expiring.ticket,revision:2}));
assert(JSON.stringify(expired)===JSON.stringify(staleByDefault),'expired refusal is indistinguishable from stale');
// Release drops the ticket; validation after release is refused identically.
const leased=await a.invoke(B.WIDGET_MOUNT,{workspaceId:'a',widgetId:'chart'});
assert((await a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:leased.ticket,revision:2})).valid===true,'leased ticket validates before release');
assert((await a.invoke(B.WIDGET_RELEASE,{workspaceId:'a',ticket:leased.ticket})).released===true,'release drops the ticket');
const afterRelease=await refusal(()=>a.invoke(B.WIDGET_VALIDATE,{workspaceId:'a',widgetId:'chart',nonce:leased.ticket,revision:2}));
assert(JSON.stringify(afterRelease)===JSON.stringify(staleByDefault),'post-release refusal is indistinguishable from stale');
console.log('board widget ticket enforcement passed');
}finally{await stop();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'board widget ticket enforcement passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20000)