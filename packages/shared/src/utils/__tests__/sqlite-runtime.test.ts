import { afterEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}) })

it('persists SQLite data across Bun and Node with rollback, readonly and closed-statement controls', async () => {
  const root = mkdtempSync(join(tmpdir(),'rox-sqlite-runtime-'))
  roots.push(root)
  const fixture = join(import.meta.dir,'sqlite-runtime.fixture.ts')
  const built = join(root,'fixture.mjs')
  const result = await Bun.build({entrypoints:[fixture],target:'node'})
  expect(result.success).toBe(true)
  await Bun.write(built, result.outputs[0]!)
  for (const [writer, reader, filename] of [[process.execPath,'node','bun.sqlite'],['node',process.execPath,'node.sqlite']]) {
    const path = join(root,filename!)
    for (const [executable, phase] of [[writer,'write'],[reader,'read']]) {
      // Node 22/24 prints the documented SQLite ExperimentalWarning. Silence
      // that warning class only; unexpected stderr and all runtime errors fail.
      const args = executable === 'node' ? ['--disable-warning=ExperimentalWarning',built] : [fixture]
      const child = Bun.spawn([executable!,...args,path,phase!],{stdout:'pipe',stderr:'pipe'})
      const [out,err,status] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      expect({status,error:err}).toEqual({status:0,error:''})
      expect(JSON.parse(out)).toMatchObject({phase,rows:1,rollback:true,readonly:true,reopen:true})
    }
  }
}, 15_000)
