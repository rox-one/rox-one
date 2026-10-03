import {test, expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dir,'../../../../../apps/electron/resources/skills/gstack/gstack');
const {compare}=await import(join(root,'design/src/compare.ts'));
const {publishBoard}=await import(join(root,'design/src/daemon-client.ts'));
test('design board output rejects planted links and writes private ordinary files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rox-design-security-'));
 try {
  const victim=join(dir,'victim'),output=join(dir,'board.html');
  writeFileSync(victim,'unchanged');symlinkSync(victim,output);
  expect(()=>compare({images:[],output})).toThrow();
  expect(readFileSync(victim,'utf8')).toBe('unchanged');
  rmSync(output);compare({images:[],output});
  expect(statSync(output).mode&0o777).toBe(0o600);
  expect(readFileSync(output,'utf8')).toContain('<!DOCTYPE html>');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('design publish refuses attacker authority strings and never follows redirects',async()=>{
 const saved=globalThis.fetch;let calls=0;
 globalThis.fetch=Object.assign(async(_url: string | URL | Request,init?: RequestInit)=>{calls++;expect(init?.redirect).toBe('manual');return Response.json({id:'fixture',url:'http://127.0.0.1:1234/board',sourceDir:''});},{preconnect:saved.preconnect});
 try{
  for(const port of ['1234@evil.test',0,65536,1.5,NaN])await expect(publishBoard({port,html:'/fixture'})).rejects.toThrow('Invalid loopback');
  expect(calls).toBe(0);
  await publishBoard({port:1234,html:'/fixture'});expect(calls).toBe(1);
 }finally{globalThis.fetch=saved;}
});
for(const copy of ['', 'gstack'])test(`iOS claim/release preserves another pidfile generation (${copy||'flat'})`,async()=>{
 const pack=resolve(root,'..',copy);
 const {tryClaim}=await import(join(pack,'ios-qa/daemon/src/single-instance.ts'));
 const dir=mkdtempSync(join(tmpdir(),'rox-ios-claim-'));
 try{
  const path=join(dir,'pid');
  const claimed=await tryClaim({path,port:1234});expect(claimed.claimed).toBe(true);
  expect((await tryClaim({path,port:1234})).claimed).toBe(false);
  writeFileSync(path,JSON.stringify({pid:process.pid,port:1234,startedAt:1}));
  await claimed.release();
  expect(JSON.parse(readFileSync(path,'utf8')).startedAt).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
