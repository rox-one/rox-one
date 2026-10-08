import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const checkout=resolve(process.argv[2]||'');
if(!checkout.startsWith('/private/tmp/rox-pocket-mac-package-aa80-')&&!checkout.startsWith('/tmp/rox-pocket-mac-package-aa80-'))throw Error('owned exact build checkout required');
const report=import.meta.dir;
const guardPath=join(checkout,'.native-headless-probe/no-ui-keychain-guard.node');
const originalPath=join(checkout,'scripts/probes/pocket-vault-native.ts');
const diagnosticsPath=join(checkout,'scripts/probes/pocket-vault-diagnostics.ts');
const {projectNativeVaultReceipt}=await import(diagnosticsPath);
const original=await readFile(originalPath,'utf8');
const identity='ROX SSO Native Vault Probe aa80-'+randomUUID().slice(0,8);
const isolation=`app.setActivationPolicy('prohibited');
const noUiGuard=require(process.env.POCKET_NO_UI_GUARD);
const guardStatus=noUiGuard.disableKeychainInteraction();
if(guardStatus!==0||noUiGuard.activationPolicy()!==2)throw new Error('headless_policy_failed');
console.log(JSON.stringify({headlessPolicy:true,activationPolicy:noUiGuard.activationPolicy(),keychainInteractionDisableStatus:guardStatus}));
app.disableHardwareAcceleration();
app.setName(${JSON.stringify(identity)})`;
const adapted=original.replace("app.setName('ROX SSO Native Vault Probe')",isolation)
 .replace("'./pocket-vault-diagnostics'",JSON.stringify(diagnosticsPath))
 .replace("'../../apps/electron/src/main/pocket-account-store'",JSON.stringify(join(checkout,'apps/electron/src/main/pocket-account-store.ts')));
if(adapted===original||adapted.includes("from './pocket-vault-diagnostics'"))throw Error('harness adaptation failed');
const directory=await mkdtemp(join(checkout,'.native-headless-probe/probe-'));
const entry=join(directory,'probe.ts'),bundle=join(directory,'probe.cjs');
await writeFile(entry,adapted);
const build=await Bun.build({entrypoints:[entry],target:'node',format:'cjs',external:['electron']});
if(!build.success||!build.outputs[0])throw Error('native_probe_bundle_failed');
await writeFile(bundle,await build.outputs[0].text());
const result:any={platform:process.platform,sourceCommit:'aa80de1b44d12a3fbbf425ce5aca8709617972ca',originalProbeSha256:createHash('sha256').update(original).digest('hex'),adaptedProbeSha256:createHash('sha256').update(adapted).digest('hex'),guardSha256:createHash('sha256').update(await readFile(guardPath)).digest('hex'),harnessDelta:['Mac activation policy prohibited before readiness','process-local Keychain interaction disabled; status and activation assertions required','unique probe app name and isolated profile','hardware acceleration disabled','absolute imports to unchanged product store and diagnostics'],receipts:[],policyReceipts:[],ownedSyntheticFixtureOnly:true,nativeStoreRestartPassed:false,scope:'Actual OS encryption and store restart; no OAuth, provider, GUI or packaged app first-launch acceptance.'};
const electron=join(checkout,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
try{
 for(const phase of ['write','read'] as const){
  const env:any={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME,LANG:'en_US.UTF-8',TMPDIR:'/tmp',ROX_CONFIG_DIR:join(directory,'config'),CRAFT_CONFIG_DIR:join(directory,'config'),POCKET_NO_UI_GUARD:guardPath};
  const child=Bun.spawn([electron,bundle,phase,directory],{cwd:checkout,env,stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
  const [stdout,,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]).finally(()=>clearTimeout(timer));
  let receipt:any;
  for(const line of stdout.split('\n')){try{const value=JSON.parse(line);if(value.headlessPolicy===true)result.policyReceipts.push({phase,activationPolicy:value.activationPolicy,keychainInteractionDisableStatus:value.keychainInteractionDisableStatus});const projected=projectNativeVaultReceipt(value,phase);if(projected)receipt=projected;}catch{}}
  if(receipt)result.receipts.push(receipt);
  if(code!==0||!receipt?.passed||receipt.profileIsolated!==true){result.failure={phase,exitCode:code,code:receipt?.code||'native_probe_receipt_missing'};break;}
 }
 result.nativeStoreRestartPassed=result.receipts.length===2&&result.receipts.every((r:any)=>r.passed)&&result.policyReceipts.length===2&&result.policyReceipts.every((p:any)=>p.activationPolicy===2&&p.keychainInteractionDisableStatus===0);
 if(!result.nativeStoreRestartPassed)process.exitCode=1;
}finally{await rm(directory,{recursive:true,force:true});result.ownedProbeDirectoryRemoved=true;await writeFile(join(report,'native-keychain-receipt.json'),JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({nativeStoreRestartPassed:result.nativeStoreRestartPassed,receipts:result.receipts.length,policyReceipts:result.policyReceipts.length,failure:result.failure||null,scope:result.scope}));
