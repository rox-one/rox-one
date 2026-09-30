import { afterEach, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

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

function availableElectronBinary(load: () => unknown): string | null {
  let binary: unknown
  try { binary = load() } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code === 'MODULE_NOT_FOUND' || failure.message.startsWith('Electron failed to install correctly')) return null
    throw error
  }
  return typeof binary === 'string' && existsSync(binary) && statSync(binary).isFile() ? binary : null
}

const requirePackage = createRequire(import.meta.url)
const electronBinary = availableElectronBinary(() => requirePackage('electron'))

async function runCommonJsFixture(executable: string): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'rox-sqlite-cjs-'))
  roots.push(root)
  const { build } = await import('esbuild')
  const built = join(root, 'fixture.cjs')
  await build({ entryPoints: [join(import.meta.dir, 'sqlite-runtime.fixture.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: built, logLevel: 'silent' })
  for (const phase of ['write', 'read']) {
    const child = Bun.spawn([executable, '--disable-warning=ExperimentalWarning', built, join(root, 'cjs.sqlite'), phase], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    const timeout = setTimeout(() => child.kill(), 5_000)
    try {
      const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect({ status, error: err }).toEqual({ status: 0, error: '' })
      expect(JSON.parse(out)).toMatchObject({ phase, rows: 1, rollback: true, readonly: true, reopen: true })
    } finally { clearTimeout(timeout); child.kill() }
  }
}

it('executes mandatory Node esbuild CommonJS SQLite operations', () => runCommonJsFixture('node'), 15_000)

// Headless installs deliberately skip downloading Electron. Absence is a SKIP,
// while a discovered binary's execution failure remains a test failure.
it.skipIf(electronBinary === null)('executes installed Electron CommonJS SQLite operations', () => runCommonJsFixture(electronBinary!), 15_000)

it('keeps Node mandatory when the exact Electron loader has no downloaded binary', () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-electron-unavailable-'))
  roots.push(root)
  const packageRoot = dirname(requirePackage.resolve('electron/package.json'))
  const copy = join(root, 'electron')
  mkdirSync(copy)
  writeFileSync(join(copy, 'index.js'), readFileSync(join(packageRoot, 'index.js')))
  writeFileSync(join(copy, 'package.json'), readFileSync(join(packageRoot, 'package.json')))
  // No path.txt/dist copied. This actually executes the installed package's
  // loader and does not delete or change the real installation.
  const unavailable = availableElectronBinary(() => requirePackage(join(copy, 'index.js')))
  expect(unavailable).toBeNull()
  expect(() => availableElectronBinary(() => { throw new Error('unexpected loader failure') })).toThrow('unexpected loader failure')
})
