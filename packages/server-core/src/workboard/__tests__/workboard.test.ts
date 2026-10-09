import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodedError } from '@rox/shared/protocol'
import { DatabaseSync } from '@rox/shared/utils/sqlite-runtime'
import { WorkspaceWorkService, type WorkspaceWorkActor, type WorkspaceWorkCatalog } from '../../workspace-work/service.ts'
import { WorkspaceWorkStore } from '../../workspace-work/store.ts'
import { WorkboardService } from '../service.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function codeOf(run: () => unknown): string {
  try { run() } catch (error) { if (error instanceof CodedError) return error.code; throw error }
  throw new Error('expected the call to throw a CodedError')
}
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex') }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workboard-')); dirs.push(root)
  const store = new WorkspaceWorkStore(root, 'workspace-a')
  const catalog: WorkspaceWorkCatalog = {
    members: () => ['author', 'other', 'manager'].map(id => ({ id, name: id })),
    hasMember: id => ['author', 'other', 'manager'].includes(id),
    hasProject: () => true, hasSource: () => true, hasSkill: () => true, hasReference: () => true,
  }
  const work = new WorkspaceWorkService(store, catalog)
  const board = new WorkboardService(store)
  const actor = (actorId: string, write = true, manage = false): WorkspaceWorkActor => ({
    actorId, canWrite: write, canDelete: write, canManage: manage,
    assertCurrent(action) { if (action !== 'read' && !write) throw new CodedError('FORBIDDEN', 'Workboard action denied') },
  })
  const createTask = () => work.write(actor('author'), { expectedRevision: store.read().revision, kind: 'createTask', input: { title: 'Card' } })
  return { root, store, work, board, author: actor('author'), other: actor('other'), reader: actor('reader', false), manager: actor('manager', true, true), createTask }
}

test('round trip read → move → read(sinceRevision=current) short-circuits unchanged', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  const initial = f.board.readBoard(f.author)
  expect(initial).toMatchObject({ revision: 1 })
  expect(initial.cards).toHaveLength(1)
  expect(initial.cards[0]).toMatchObject({ taskId: id, column: 'todo', title: 'Card', dueAt: null, revision: 1 })

  const moved = f.board.move(f.author, { expectedRevision: initial.revision, taskId: id, column: 'in-progress' })
  expect(moved).toMatchObject({ revision: 2 })
  expect(moved.task).toMatchObject({ taskId: id, column: 'in-progress', revision: 2 })

  expect(f.board.readBoard(f.author, { sinceRevision: moved.revision })).toEqual({ revision: 2, cards: [], unchanged: true })
  // A pre-move revision still returns the full board payload.
  expect(f.board.readBoard(f.author, { sinceRevision: initial.revision }).cards).toHaveLength(1)
  expect(f.board.readBoard(f.author, { sinceRevision: initial.revision }).unchanged).toBeUndefined()
})

test('stale expectedRevision is REVISION_CONFLICT and leaves the on-disk state byte-identical', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  const before = sha256(f.store.filePath)
  expect(codeOf(() => f.board.move(f.author, { expectedRevision: 0, taskId: id, column: 'done' }))).toBe('REVISION_CONFLICT')
  expect(sha256(f.store.filePath)).toBe(before)
  expect(f.store.read().tasks[0]!.status).toBe('todo')
})

test('unknown and tombstoned tasks are NOT_FOUND', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  expect(codeOf(() => f.board.move(f.author, { expectedRevision: 1, taskId: 'task_unknown', column: 'done' }))).toBe('NOT_FOUND')
  f.work.delete(f.author, { expectedRevision: 1, kind: 'task', id })
  expect(codeOf(() => f.board.move(f.author, { expectedRevision: 2, taskId: id, column: 'done' }))).toBe('NOT_FOUND')
  expect(f.store.read().revision).toBe(2)
})

test('a task owned by a foreign workspace is WORKSPACE_MISMATCH for this board', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  const foreign = new WorkboardService(new WorkspaceWorkStore(f.root, 'workspace-b'))
  expect(codeOf(() => foreign.move(f.author, { expectedRevision: 1, taskId: id, column: 'done' }))).toBe('WORKSPACE_MISMATCH')
  expect(codeOf(() => foreign.readBoard(f.author))).toBe('WORKSPACE_MISMATCH')
})

test('capability and editor rules: read-only and non-editor writers are FORBIDDEN, manager allowed', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  expect(codeOf(() => f.board.move(f.reader, { expectedRevision: 1, taskId: id, column: 'done' }))).toBe('FORBIDDEN')
  f.work.write(f.other, { expectedRevision: 1, kind: 'commentTask', taskId: id, text: 'Member' })
  expect(codeOf(() => f.board.move(f.other, { expectedRevision: 2, taskId: id, column: 'done' }))).toBe('FORBIDDEN')
  const moved = f.board.move(f.manager, { expectedRevision: 2, taskId: id, column: 'done' })
  expect(moved.task.column).toBe('done')
})

test('rank override is rejected, not silently dropped', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  expect(codeOf(() => f.board.move(f.author, { expectedRevision: 1, taskId: id, column: 'done', rank: 'a0' }))).toBe('UNSUPPORTED_OPERATION')
  expect(f.store.read().tasks[0]!.status).toBe('todo')
})

test('concurrent commits serialise: the loser is REVISION_CONFLICT with no lost update', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  const first = new WorkboardService(new WorkspaceWorkStore(f.root, 'workspace-a'))
  const second = new WorkboardService(new WorkspaceWorkStore(f.root, 'workspace-a'))
  expect(first.move(f.author, { expectedRevision: 1, taskId: id, column: 'in-progress' }).revision).toBe(2)
  expect(codeOf(() => second.move(f.author, { expectedRevision: 1, taskId: id, column: 'done' }))).toBe('REVISION_CONFLICT')
  const state = f.store.read()
  expect(state.revision).toBe(2)
  expect(state.tasks[0]!.status).toBe('in-progress')
})

test('a held writer lease surfaces DOCUMENT_BUSY', () => {
  const f = fixture()
  const id = f.createTask().receipt.entityId
  const lease = new DatabaseSync(f.store.leasePath)
  lease.exec('BEGIN IMMEDIATE')
  try {
    expect(codeOf(() => f.board.move(f.author, { expectedRevision: 1, taskId: id, column: 'done' }))).toBe('DOCUMENT_BUSY')
  } finally { lease.exec('ROLLBACK'); lease.close() }
  expect(f.store.read().tasks[0]!.status).toBe('todo')
})

test('the real workboard RPC surface pushes workboard:changed with the new revision', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'workboard-rpc-'))
  try {
    const proc = Bun.spawn(['bun', '-e', `
const {mkdirSync,realpathSync}=await import('node:fs');
const {join}=await import('node:path');
const {NativeAuthority}=await import('./packages/server-core/src/authority/native-authority.ts');
const {WsRpcServer}=await import('./packages/server-core/src/transport/server.ts');
const {WsRpcClient}=await import('./packages/server-core/src/transport/client.ts');
const {registerWorkspaceWorkHandlers}=await import('./packages/server-core/src/handlers/rpc/workspace-work.ts');
const {registerWorkboardHandlers}=await import('./packages/server-core/src/handlers/rpc/workboard.ts');
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
const author=enroll('Author'),reader=enroll('Reader');
authority.grantWorkspace(admin.credential,author.principal.subject,'a',['read','write','delete','subscribe']);
authority.grantWorkspace(admin.credential,reader.principal.subject,'a',['read']);
let server;const clients=[];
const assert=(value,message)=>{if(!value)throw Error(message)};
const denied=async run=>{let failed=false;try{await run()}catch{failed=true}assert(failed,'expected denial')};
// Cross-process WS push delivery needs a real await; deterministic timers cannot drive a socket.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const start=async()=>{server=new WsRpcServer({host:'127.0.0.1',port:0,requireAuth:true,nativeAuthority:authority,
nativeEventChannels:new Set([RPC_CHANNELS.workboard.CHANGED])});
const deps={sessionManager:{getSessions:()=>[]},nativeData:{authority},platform:{logger:{info(){},warn(){},error(){},debug(){}}}};
registerWorkspaceWorkHandlers(server,deps);registerWorkboardHandlers(server,deps);await server.listen()};
const connect=issued=>{const c=new WsRpcClient('ws://127.0.0.1:'+server.port,{token:issued.credential,workspaceId:'a',mode:'remote',autoReconnect:false,requestTimeout:1000,connectTimeout:1000});clients.push(c);c.connect();return c};
const stop=async()=>{for(const c of clients.splice(0))c.destroy();await new Promise(r=>setTimeout(r,20));server.close()};
const W=RPC_CHANNELS.workboard,WW=RPC_CHANNELS.workspaceWork;
try{await start();const a=connect(author),r=connect(reader);
const pushes=[];a.on(W.CHANGED,payload=>pushes.push(payload));
const created=await a.invoke(WW.WRITE,'a',{expectedRevision:0,kind:'createTask',input:{title:'Bridge card'}});
const id=created.snapshot.tasks[0].id;
const read=await a.invoke(W.READ,{workspaceId:'a',sinceRevision:0});
assert(read.revision===1&&read.cards.length===1&&read.cards[0].taskId===id&&read.cards[0].column==='todo','workboard read projection');
await denied(()=>r.invoke(W.MOVE,{workspaceId:'a',expectedRevision:1,taskId:id,column:'done'}));
const moved=await a.invoke(W.MOVE,{workspaceId:'a',expectedRevision:1,taskId:id,column:'in-progress'});
assert(moved.revision===2&&moved.task.column==='in-progress','workboard move');
for(let i=0;i<50&&pushes.length===0;i++)await sleep(20);
assert(pushes.length===1&&pushes[0].revision===2,'workboard:changed push revision');
const unchanged=await a.invoke(W.READ,{workspaceId:'a',sinceRevision:2});
assert(unchanged.unchanged===true&&unchanged.cards.length===0,'since-revision short circuit');
await denied(()=>a.invoke(W.READ,{workspaceId:'b'}));
await denied(()=>a.invoke(W.MOVE,{workspaceId:'a',expectedRevision:1,taskId:id,column:'done'}));
console.log('workboard native RPC push passed');
}finally{await stop();authority.close()}
process.exit(0);
`], { cwd: join(import.meta.dir, '../../../../..'), env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe' })
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'workboard native RPC push passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 20000)