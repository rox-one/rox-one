import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareOmpNativePolicy} from '../omp-native-policy';
test('native policy refuses another version or altered source before creating an overlay',()=>{
 const root=mkdtempSync(join(tmpdir(),'rox-native-policy-test-'));
 try{
  const pkg=join(root,'package'),runtime=join(root,'runtime');mkdirSync(join(pkg,'src/session'),{recursive:true});mkdirSync(runtime);
  writeFileSync(join(pkg,'package.json'),JSON.stringify({version:'18.4.11'}));
  expect(()=>prepareOmpNativePolicy(pkg,runtime)).toThrow('pinned OMP');
  writeFileSync(join(pkg,'package.json'),JSON.stringify({version:'18.4.12'}));
  writeFileSync(join(pkg,'src/session/agent-session.ts'),'altered');
  expect(()=>prepareOmpNativePolicy(pkg,runtime)).toThrow('integrity mismatch');
  expect(readdirSync(runtime)).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
