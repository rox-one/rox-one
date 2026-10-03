import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Run module mocks in a fresh process so the shared credential/client exports
// cannot affect unrelated RPC or live transport suites.
test('source tool listing resolves vault credentials and portable paths and always closes the client', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-tools-runtime-'))
  try {
    const child = Bun.spawn([process.execPath, '-e', `
const {mock}=await import('bun:test');
const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');const {join}=await import('node:path');
const root=process.env.ROX_CONFIG_DIR,workspaceRoot=join(root,'workspace');mkdirSync(workspaceRoot);
writeFileSync(join(root,'config-defaults.json'),JSON.stringify({version:'test',workspaceDefaults:{localMcpServers:{enabled:true}}}));
let clients=[],closed=0,fail=false;
const credentialExports=await import('@craft-agent/shared/credentials');
mock.module('@craft-agent/shared/credentials',()=>({...credentialExports,getCredentialManager:()=>({get:async id=>id.sourceId==='firecrawl-mcp'?{value:'vault-secret'}:null})}));
const mcpExports=await import('@craft-agent/shared/mcp');
mock.module('@craft-agent/shared/mcp',()=>({...mcpExports,CraftMcpClient:class{constructor(config){clients.push(config)}async listTools(){if(fail)throw Error('401 unauthorized');return [{name:'probe_tool',description:'fixture'}]}async close(){closed++}}}));
const {saveConfig}=await import('./packages/shared/src/config/storage.ts');saveConfig({workspaces:[{id:'ws',name:'Test',rootPath:workspaceRoot,createdAt:1}],activeWorkspaceId:'ws',activeSessionId:null});
const {ensureBuiltinMcpSources,loadSourceConfig,saveSourceConfig}=await import('./packages/shared/src/sources/index.ts');ensureBuiltinMcpSources(workspaceRoot);
const {registerSourcesHandlers}=await import('./packages/server-core/src/handlers/rpc/sources.ts');const {RPC_CHANNELS}=await import('./packages/shared/src/protocol/index.ts');
const handlers=new Map();const logger={info(){},warn(){},error(){},debug(){}};
registerSourcesHandlers({handle:(name,fn)=>handlers.set(name,fn)},{platform:{logger},sessionManager:{}});
const invoke=slug=>handlers.get(RPC_CHANNELS.sources.GET_MCP_TOOLS)({workspaceId:'ws'},'ws',slug);
const checks=[];function check(name,condition){if(!condition)throw Error(name);checks.push(name)};
const first=await invoke('firecrawl-mcp');check('vault credential admits prior needs_auth status: '+JSON.stringify(first),first.success===true);
check('credential resolved only in process environment',clients[0].env.FIRECRAWL_API_KEY==='vault-secret');
check('disk does not contain secret',!readFileSync(join(workspaceRoot,'sources','firecrawl-mcp','config.json'),'utf8').includes('vault-secret'));
check('successful client closed',closed===1);
fail=true;const failed=await invoke('firecrawl-mcp');check('existing auth error type preserved',failed.success===false&&failed.error.includes('Authentication failed'));
check('failed client also closed',closed===2);fail=false;
saveSourceConfig(workspaceRoot,{id:'custom-portable',slug:'portable',name:'Portable',enabled:true,provider:'custom',type:'mcp',connectionStatus:'connected',mcp:{transport:'stdio',command:'\u0024{CRAFT_CONFIG_DIR}/server.exe',args:['\u0024{WORKSPACE}/fixture'],authType:'none'}});
const portable=await invoke('portable');check('portable command and arguments resolved',portable.success===true&&clients.at(-1).command===join(root,'server.exe')&&clients.at(-1).args[0]===join(workspaceRoot,'fixture'));
const windows=await invoke('windows-mcp');if(process.platform!=='win32')check('native Windows server not spawned on unsupported platform',windows.success===false&&windows.error.includes('Windows')&&clients.length===3);
const disabled=loadSourceConfig(workspaceRoot,'firecrawl-mcp');disabled.enabled=false;saveSourceConfig(workspaceRoot,disabled);const disabledResult=await invoke('firecrawl-mcp');check('disabled source never spawned',disabledResult.success===false&&clients.length===3);
console.log(JSON.stringify(checks));process.exit(0);
`], {
      cwd: join(import.meta.dir, '../../../../../..'),
      env: { ...process.env, ROX_CONFIG_DIR: root, CRAFT_CONFIG_DIR: root, FIRECRAWL_API_KEY: '', CRAFT_FIRECRAWL_API_KEY: '', ROX_FIRECRAWL_API_KEY: '' },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
    expect(JSON.parse(stdout)).toHaveLength(process.platform === 'win32' ? 8 : 9)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 15000)
