/**
 * c1.7 wiki RPC surface: memory:wikiApply → memory:wikiList round-trips over the
 * REAL registered handlers, and the claims file lands on disk.
 *
 * Runs the production imports in a fresh process (like the memory-index RPC
 * acceptance test) so ROX_CONFIG_DIR is honoured before @rox/shared/config
 * snapshots it.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runtime = `
const {existsSync,mkdirSync,writeFileSync}=await import('node:fs');
const {join}=await import('node:path');
const root=process.env.ROX_CONFIG_DIR;
const wsRoot=join(root,'ws');
mkdirSync(join(wsRoot,'memory'),{recursive:true});
writeFileSync(join(wsRoot,'memory','context.md'),'Deploys go through vercel.');
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');
saveConfig({workspaces:[{id:'ws1',name:'WS',rootPath:wsRoot,createdAt:1}],activeWorkspaceId:'ws1',activeSessionId:null});
const {registerMemoryHandlers,HANDLED_CHANNELS}=await import('./packages/server-core/src/handlers/rpc/memory.ts');
const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const assert=(v,m)=>{if(!v)throw Error(m)};
const handlers=new Map();
const server={handle:(ch,fn)=>{handlers.set(ch,fn)},push:()=>{}};
registerMemoryHandlers(server,{platform:{logger:{info(){},warn(){},error(){},debug(){}}}});
for(const ch of [RPC_CHANNELS.memory.WIKI_LIST,RPC_CHANNELS.memory.WIKI_GET,RPC_CHANNELS.memory.WIKI_APPLY,RPC_CHANNELS.memory.WIKI_LINT]) assert(HANDLED_CHANNELS.includes(ch)&&handlers.has(ch),'channel not registered: '+ch);
const ctx={workspaceId:'ws1',webContentsId:null,principal:null};
const wsArgs={workspaceId:'ws1'};
const applied=await handlers.get(RPC_CHANNELS.memory.WIKI_APPLY)(ctx,{...wsArgs,mutation:{op:'upsert',claim:{id:'c1',text:'Deploys go through vercel.',status:'active',evidence:[{source:'memory/context.md',quote:'vercel'}],revision:0}}});
assert(applied&&applied.claim.id==='c1'&&applied.revision===1,'apply result wrong: '+JSON.stringify(applied));
assert(existsSync(join(wsRoot,'memory','wiki','claims.jsonl')),'claims file missing on disk');
const listed=await handlers.get(RPC_CHANNELS.memory.WIKI_LIST)(ctx,wsArgs);
assert(listed.claims.length===1&&listed.claims[0].id==='c1','list did not round-trip: '+JSON.stringify(listed));
const got=await handlers.get(RPC_CHANNELS.memory.WIKI_GET)(ctx,{...wsArgs,id:'c1'});
assert(got.claim&&got.claim.text==='Deploys go through vercel.','get did not round-trip: '+JSON.stringify(got));
assert((await handlers.get(RPC_CHANNELS.memory.WIKI_GET)(ctx,{...wsArgs,id:'missing'})).claim===null,'unknown id must be null');
const linted=await handlers.get(RPC_CHANNELS.memory.WIKI_LINT)(ctx,wsArgs);
assert(linted.report.claimsChecked===1,'lint checked wrong count: '+JSON.stringify(linted.report));
assert(linted.digestPath&&existsSync(linted.digestPath),'digest file missing: '+linted.digestPath);
await handlers.get(RPC_CHANNELS.memory.WIKI_APPLY)(ctx,{...wsArgs,mutation:{op:'retract',claimId:'c1',reason:'superseded'}});
const after=await handlers.get(RPC_CHANNELS.memory.WIKI_LIST)(ctx,wsArgs);
assert(after.claims.length===1&&after.claims[0].status==='retracted','retract did not round-trip: '+JSON.stringify(after));
console.log('wiki rpc passed');
`

test('wiki RPC handlers apply/list/get/lint against a real workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-rpc-'))
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
    expect({ exit, stdout }).toEqual({ exit: 0, stdout: 'wiki rpc passed\n' })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 20000)