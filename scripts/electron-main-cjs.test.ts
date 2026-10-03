import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { ELECTRON_MAIN_CJS_FLAGS } from './electron-main-cjs'

const repo = resolve(import.meta.dir, '..')
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Use the actual canonical main build command, without loading its .env or main entry. */
function mainBuildCommand(): string[] {
  const file = join(import.meta.dir, 'electron-build-main.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let main: ts.FunctionDeclaration | undefined
  let defines: ts.FunctionDeclaration | undefined
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement)) continue
    if (statement.name?.text === 'main') main = statement
    if (statement.name?.text === 'getBuildDefines') defines = statement
  }
  let command: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'proc' && node.initializer && ts.isCallExpression(node.initializer)) {
      const options = node.initializer.arguments[0]
      if (options && ts.isObjectLiteralExpression(options)) {
        const property = options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'cmd')
        if (property && ts.isPropertyAssignment(property)) command = property.initializer
      }
    }
    ts.forEachChild(node, visit)
  }
  if (main) visit(main)
  if (!command || !defines) throw new Error('Canonical main esbuild command was not found')
  const code = ts.transpileModule(`${defines.getText(source)}\nconst buildDefines = getBuildDefines();\nconst actual = ${command.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText
  // The production define function sees an empty object; no credential is read.
  return new Function('process', 'ELECTRON_MAIN_CJS_FLAGS', 'OUTPUT_FILE', `${code}; return actual;`)(
    { env: {}, argv: [] }, ELECTRON_MAIN_CJS_FLAGS, join(repo, 'apps/electron/dist/main.cjs'),
  )
}

async function compileFixture(): Promise<{ root: string; built: string }> {
  const root = mkdtempSync(join(tmpdir(), 'rox-electron-cjs-'))
  roots.push(root)
  const built = join(root, 'sqlite-probe.cjs')
  const fixture = 'packages/shared/src/utils/__tests__/sqlite-runtime.fixture.ts'
  const command = mainBuildCommand().map(argument => argument === 'apps/electron/src/main/index.ts' ? fixture
    : argument.startsWith('--outfile=') ? `--outfile=${built}` : argument)
  const child = Bun.spawn(command, { cwd: repo, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ exit, stdout, error: exit ? stderr : '' }).toEqual({ exit: 0, stdout: '', error: '' })
  return { root, built }
}

async function coldFixture(executable: string, built: string, database: string, phase: 'write' | 'read') {
  const args = executable === 'node' ? ['--disable-warning=ExperimentalWarning', built] : [built]
  const child = Bun.spawn([executable, ...args, database, phase], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ exit, error: stderr }).toEqual({ exit: 0, error: '' })
  return JSON.parse(stdout) as { runtime: string; phase: string; rows: number; rollback: boolean; readonly: boolean; reopen: boolean }
}

test('Electron main CommonJS flags cold-load the unchanged SQLite adapter on Node with durable runtime controls', async () => {
  const { root, built } = await compileFixture()
  const database = join(root, 'durable.sqlite')
  for (const phase of ['write', 'read'] as const) {
    const result = await coldFixture('node', built, database, phase)
    expect(result.runtime).toMatch(/^Node (22|24)\./)
    expect(result).toMatchObject({ phase, rows: 1, rollback: true, readonly: true, reopen: true })
  }
  // The actual adapter fixture retains 64 statements then closes them; this
  // cold Bun read also exercises immediate finalization in its Bun branch.
  const result = await coldFixture(process.execPath, built, database, 'read')
  expect(result.runtime).toMatch(/^Bun /)
  expect(result).toMatchObject({ phase: 'read', rows: 1, rollback: true, readonly: true, reopen: true })
}, 15_000)

test('Electron main CommonJS module URL follows a relocated bundle with spaces and non-ASCII path characters', async () => {
  const { root, built } = await compileFixture()
  const relocatedDir = join(root, 'relocated bundle # проверка')
  mkdirSync(relocatedDir)
  const relocated = join(relocatedDir, 'main probe.cjs')
  copyFileSync(built, relocated)
  const database = join(root, 'relocated.sqlite')
  const result = await coldFixture('node', relocated, database, 'write')
  expect(result.runtime).toMatch(/^Node (22|24)\./)
  expect(result).toMatchObject({ phase: 'write', rows: 1, rollback: true, readonly: true, reopen: true })
}, 15_000)
