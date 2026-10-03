import { expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
it('actual registerCoreRpcHandlers serves Connect/bootstrap/logout over authenticated local RPC',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pocket-core-registry-'))
 try{
  const child=Bun.spawn([process.execPath,join(import.meta.dir,'pocket-core-registry.fixture.ts')],{cwd:join(import.meta.dir,'../../../../../..'),env:{...process.env,ROX_CONFIG_DIR:directory,CRAFT_CONFIG_DIR:directory},stdout:'pipe',stderr:'pipe'})
  const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
  expect({code,out,err}).toMatchObject({code:0})
  expect(JSON.parse(out.trim().split('\n').at(-1)!)).toHaveLength(12)
 }finally{rmSync(directory,{recursive:true,force:true})}
},20000)
