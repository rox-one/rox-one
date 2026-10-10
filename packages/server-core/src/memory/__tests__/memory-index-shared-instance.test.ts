/**
 * Shared-instance regression (issue: shared-instance drift).
 *
 * With `memory.semantic: true`, MemoryService and the RPC memory handlers MUST
 * reach the SAME cached MemoryIndexService. The factory caches per
 * `${root}\0s{emantic|lexical}`, so an RPC path that passes no options (always
 * lexical) would leave the workspace with two instances: they read/write
 * different indices, and a lexical rebuild clobbers the semantic instance's
 * `embedded` state while its cached meta still claims embeddings.
 *
 * Runs the production imports in a fresh process (like memory-index-rpc), so
 * ROX_CONFIG_DIR is honoured before @rox/shared/config snapshots it.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runtime = `
const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');
const {join}=await import('node:path');
const root=process.env.ROX_CONFIG_DIR;
const wsRoot=join(root,'ws');
mkdirSync(join(wsRoot,'memory'),{recursive:true});
writeFileSync(join(wsRoot,'memory','context.md'),'Deploy previews go through vercel.');
writeFileSync(join(root,'config.json'),JSON.stringify({
  workspaces:[{id:'ws1',name:'WS',rootPath:wsRoot,createdAt:1}],
  activeWorkspaceId:'ws1',activeSessionId:null,llmConnections:[],
  memory:{semantic:true},
},null,2));
const assert=(v,m)=>{if(!v)throw Error(m)};

const {getMemoryConfig}=await import('./packages/shared/src/config/storage.ts');
assert(getMemoryConfig().semantic===true,'premise: memory.semantic must be on');
const {MemoryService}=await import('./packages/server-core/src/memory/MemoryService.ts');
const {memoryIndexServiceFor,memoryIndexServiceOptions}=await import('./packages/server-core/src/memory/MemoryIndexService.ts');
const {registerMemoryHandlers,HANDLED_CHANNELS}=await import('./packages/server-core/src/handlers/rpc/memory.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');

// Constructed exactly as SessionManager does it: no getConfig, so the service
// resolves the global memory config (semantic:true here).
const svc=new MemoryService({workspaceRoot:wsRoot,workspaceId:'ws1',logger:{warn(){}}});
const agentIndex=svc.indexService;

// Warm the instance's meta cache while no index exists on disk.
assert(agentIndex.status().state==='absent','precondition: index must start absent');
// The shared helper maps the canonical config to the semantic cache key.
assert(memoryIndexServiceFor(wsRoot,'ws1',memoryIndexServiceOptions(getMemoryConfig()))===agentIndex,
  'MemoryService index must be the cached semantic instance');
// The bare (lexical) key is a DIFFERENT object — documented factory behaviour;
// it is precisely what the RPC path must not fall back to.
assert(memoryIndexServiceFor(wsRoot,'ws1')!==agentIndex,'lexical-key instance must differ');
assert(memoryIndexServiceOptions(getMemoryConfig()).semantic===true,
  'the shared helper must carry the resolved semantic flag to the factory');

const handlers=new Map();
registerMemoryHandlers({handle:(ch,fn)=>{handlers.set(ch,fn)},push:()=>{}},{platform:{logger:{info(){},warn(){},error(){},debug(){}}}});
for(const ch of [RPC_CHANNELS.memory.SEARCH,RPC_CHANNELS.memory.GET,RPC_CHANNELS.memory.INDEX_STATUS,RPC_CHANNELS.memory.REBUILD_INDEX]) assert(HANDLED_CHANNELS.includes(ch)&&handlers.has(ch),'channel not registered: '+ch);

const ctx={workspaceId:'ws1',webContentsId:null,principal:null};
const rpcStatus=await handlers.get(RPC_CHANNELS.memory.INDEX_STATUS)(ctx,'ws1');
assert(rpcStatus.state==='absent','RPC status must observe the same absent instance');
const rebuilt=await handlers.get(RPC_CHANNELS.memory.REBUILD_INDEX)(ctx,'ws1');
assert(rebuilt.ok&&rebuilt.state==='ready'&&rebuilt.chunks===1,'rebuild status wrong: '+JSON.stringify(rebuilt));

// IDENTITY PROOF: the RPC rebuild ran on the very object MemoryService holds,
// so the instance's cached meta advanced from absent to ready. A second
// (lexical) instance would have rebuilt its own copy and left this one
// reporting the stale cached 'absent' meta.
const after=agentIndex.status();
assert(after.state==='ready'&&after.chunks===1,'RPC rebuild must be visible on the MemoryService instance, got '+JSON.stringify(after));

// The rebuild records embedded:false on disk AND on the shared instance, so a
// semantic search follows it by re-embedding instead of trusting a stale
// embedded:true claim. (The embeddings-READY half cannot be constructed here:
// the shared factory passes no embedder/loadEmbedder seam — those exist only on
// the direct MemoryIndexService constructor — and the real loader
// loadXenovaEmbedder has no model in the test env, so searchSemantic always
// falls back to lexical.)
const meta=JSON.parse(readFileSync(join(wsRoot,'memory','chunk-index.meta.json'),'utf8'));
assert(meta.embedded===false,'rebuilt meta must record no embeddings');
assert((await handlers.get(RPC_CHANNELS.memory.INDEX_STATUS)(ctx,'ws1')).state==='ready','RPC status must agree after rebuild');
console.log('memory index shared instance passed');
`

test('RPC memory handlers and MemoryService share one semantic index instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-index-shared-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', runtime], {
      cwd: join(import.meta.dir, '../../../../..'),
      env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe('')
    expect({ exit, stdout }).toEqual({ exit: 0, stdout: 'memory index shared instance passed\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 20000)