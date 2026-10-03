// Test-only dependency composition of the unchanged production providers.
// Keychain commands use a private hanging executable; never call the user's OS provider.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as fs from 'node:fs/promises';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=resolve(import.meta.dirname,'../../..');
const privateRoot=mkdtempSync(join(tmpdir(),'rox-runtime-edge-proof-'));
const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform');
const originalKill=process.kill;
const fixturePid=2147000091;
let cases=0;
try {
  const hanging=join(privateRoot,'provider');
  writeFileSync(hanging, '#!'+process.execPath+'\nsetInterval(()=>{},1000)\n',{mode:0o700});chmodSync(hanging,0o700);
  globalThis.edgeProviderCalls=[];
  const childMock=`import {spawnSync as realSpawnSync} from 'node:child_process';export const execSync=()=>{throw Error('fixture denies machine inventory')};export function spawnSync(command,args,options){globalThis.edgeProviderCalls.push({command,operation:args[0],timeout:options?.timeout,killSignal:options?.killSignal});if(options?.timeout!==3000||options?.killSignal!=='SIGKILL')throw Error('Unbounded provider command');return realSpawnSync(${JSON.stringify(hanging)},[],options);}`;
  const credentialOut=join(privateRoot,'credentials.mjs');
  await build({entryPoints:[join(root,'packages/shared/src/credentials/backends/secure-storage.ts')],outfile:credentialOut,bundle:true,format:'esm',platform:'node',plugins:[{name:'private-provider-only',setup(b){b.onResolve({filter:/^child_process$/},()=>({path:'child',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:childMock,loader:'js'}));}}]});
  const {SecureStorageBackend}=await import(pathToFileURL(credentialOut).href);
  for(const platform of ['darwin','linux']) {
    Object.defineProperty(process,'platform',{value:platform});
    const dir=join(privateRoot,platform);await fs.mkdir(dir,{mode:0o700});
    const began=Date.now();const backend=new SecureStorageBackend(dir);
    const id={type:'source_bearer',name:'synthetic',workspaceId:'proof',sourceId:'proof'};
    await backend.set(id,{value:'synthetic-local-only'});
    assert.equal(globalThis.edgeProviderCalls.length,(platform==='darwin'?3:6));
    assert.ok(globalThis.edgeProviderCalls.every(call=>call.timeout===3000&&call.killSignal==='SIGKILL'));
    assert.deepEqual(await backend.get(id),{value:'synthetic-local-only'});
    assert.ok(Date.now()-began<15000,'three private provider attempts stay bounded');
    assert.equal((await fs.stat(join(dir,'credentials.key'))).mode&0o777,0o600);
    console.log(JSON.stringify({case:'private hanging keychain fallback',platform,calls:3,elapsedMs:Date.now()-began,provider:'private executable',realOSProvider:false}));cases++;
  }
  Object.defineProperty(process,'platform',originalPlatform);
  const providerOut=join(privateRoot,'local.mjs');
  globalThis.edgeProbe={state:'Z',error:null,killError:null,transition:null};
  const fsMock=`import * as real from 'node:fs/promises';export const {access,appendFile,mkdir,readdir,stat,writeFile}=real;export async function readFile(path,...args){if(String(path).startsWith('/proc/')){const p=globalThis.edgeProbe;if(p.transition)await p.transition();if(p.error)throw Object.assign(Error('controlled proc probe'),{code:p.error});return '2147000091 (name with ) parentheses) '+p.state+' 0 0 0';}return real.readFile(path,...args);}`;
  await build({entryPoints:[join(root,'packages/cloud-runner/src/local-provider.ts')],outfile:providerOut,bundle:true,format:'esm',platform:'node',plugins:[{name:'controlled-proc-only',setup(b){b.onResolve({filter:/^node:fs\/promises$/},a=>a.namespace==='mock'?{path:a.path,external:true}:{path:'fs',namespace:'mock'});b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:fsMock,loader:'js'}));}}]});
  const {LocalSubprocessProvider}=await import(pathToFileURL(providerOut).href);
  Object.defineProperty(process,'platform',{value:'linux'});
  process.kill=function(pid,...args){assert.equal(pid,fixturePid,'only synthetic pid may be probed');if(globalThis.edgeProbe.killError)throw Object.assign(Error('controlled kill'),{code:globalThis.edgeProbe.killError});return true;};
  for(const scenario of [
    {name:'zombie',state:'Z',expected:'failed'},
    {name:'dead-X',state:'X',expected:'failed'},
    {name:'live-parenthesized-name',state:'S',expected:'queued'},
    {name:'reaped-during-probe',error:'ENOENT',expected:'failed'},
    {name:'proc-permission-unknown',error:'EACCES',expected:'queued'},
    {name:'kill-permission-alive',killError:'EPERM',expected:'queued'},
    {name:'kill-no-process',killError:'ESRCH',expected:'failed'},
    {name:'cancelled-during-dead-probe',state:'Z',expected:'cancelled',transition:true},
  ]) {
    const dir=join(privateRoot,scenario.name);await fs.mkdir(dir,{recursive:true});const path=join(dir,'state.json');
    const initial={id:scenario.name,state:'queued',createdAt:1};await fs.writeFile(path,JSON.stringify(initial));await fs.writeFile(join(dir,'runner.pid'),String(fixturePid));
    globalThis.edgeProbe={state:scenario.state??'S',error:scenario.error??null,killError:scenario.killError??null,transition:scenario.transition?async()=>fs.writeFile(path,JSON.stringify({...initial,state:'cancelled',finishedAt:9})):null};
    const provider=new LocalSubprocessProvider({baseDir:privateRoot,runnerCommand:['fixture-unused']});
    const result=await provider.getStatus(scenario.name);assert.equal(result.state,scenario.expected,scenario.name);
    assert.equal(JSON.parse(await fs.readFile(path,'utf8')).state,scenario.expected);
    console.log(JSON.stringify({case:scenario.name,result:result.state,actualProvider:true,linuxProc:'controlled dependency',nativeLinuxAcceptance:false}));cases++;
  }
  console.log(JSON.stringify({passed:cases,failed:0,realKeychainCommands:0,realSyntheticPidSignals:0}));
} finally {process.kill=originalKill;Object.defineProperty(process,'platform',originalPlatform);delete globalThis.edgeProbe;delete globalThis.edgeProviderCalls;rmSync(privateRoot,{recursive:true,force:true});}
