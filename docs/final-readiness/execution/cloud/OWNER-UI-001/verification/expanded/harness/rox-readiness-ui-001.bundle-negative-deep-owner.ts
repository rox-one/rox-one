import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { build, version as esbuildVersion } from 'esbuild'
import ts from 'typescript'
function repositoryRoot(start: string): string {
  for (let path = start; ; path = dirname(path)) {
    if (existsSync(join(path, 'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx')) && existsSync(join(path, 'bunfig.toml'))) return path
    if (dirname(path) === path) throw new Error('Repository root unavailable')
  }
}
const root = repositoryRoot(import.meta.dir)
process.chdir(root)
const lane = process.argv[2]
if (!['navigation', 'main'].includes(lane)) throw new Error('Pass navigation or main')
if (process.env.ROX_UI001_NAV_FIXTURE_BUNDLE || process.env.ROX_UI001_MAIN_FIXTURE_BUNDLE) throw new Error('Unset prebuilt bundle environment before compiling fresh source')
const filePath = lane === 'navigation'
  ? 'apps/electron/src/renderer/contexts/__tests__/rox-readiness-ui-001.navigation-browser.test.ts'
  : 'apps/electron/src/renderer/components/app-shell/__tests__/rox-readiness-ui-001.browser.test.ts'
const output = resolve(process.argv[3] ?? `work/rox-readiness-ui-001.${lane}-fixture.js`)
mkdirSync(dirname(output), { recursive: true })
const source = readFileSync(filePath, 'utf8')
const ast = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = new Set(lane === 'navigation' ? ['fixtureBundle'] : ['productionFunctions', 'workspaceRestoreEffect', 'fixtureBundle'])
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? ''))
  .map(node => node.getText(ast)).join('\n').replaceAll('import.meta.dir', JSON.stringify(dirname(resolve(filePath))))
if (ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text ?? '')).length !== names.size) throw new Error('Production fixture functions changed')
let inputs: string[] = []
const capturedBuild = async (options: Parameters<typeof build>[0]) => {
  const result = await build({ ...options, metafile: true, plugins: [...(options.plugins ?? []), {
    name: 'actual-committed-old-deep-link-owner-negative-control',
    setup(builder: any) {
      builder.onLoad({filter: /\/NavigationContext\.tsx$/}, (args: any) => ({
        contents: readFileSync(join(root,'work/rox-readiness-ui-001.NavigationContext-negative-5a0.tsx'),'utf8'),
        loader:'tsx', resolveDir:dirname(args.path),
      }))
    },
  }] })
  inputs = Object.keys(result.metafile!.inputs).filter(path => path !== '<stdin>' && !path.startsWith('fixture:'))
  return result
}
const javascript = ts.transpileModule(functions + '\nreturn fixtureBundle()', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
const bundle: string = await Function('root', 'readFileSync', 'ts', 'join', 'build', javascript)(root, readFileSync, ts, join, capturedBuild)
writeFileSync(output, bundle)
const injectedInputs = lane === 'main' ? [process.env.ROX_UI001_MAIN_SOURCE ?? 'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx', 'apps/electron/src/renderer/components/app-shell/AppShell.tsx'] : []
const sourceInputs = [...new Set([filePath, ...injectedInputs, ...inputs])]
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const revision = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: root })
if (revision.exitCode !== 0) throw new Error('Source revision unavailable')
const manifest = {
  sourceRevision: Buffer.from(revision.stdout).toString().trim(), lane,
  bundlerRuntime: { bun: Bun.version, bunRevision: Bun.revision, esbuild: esbuildVersion },
  bundlePath: output, bundleSha256: sha256(bundle),
  inputSha256: Object.fromEntries(sourceInputs.map(path => [path, sha256(readFileSync(path))])),
}
const oldSource = readFileSync(join(root,'work/rox-readiness-ui-001.NavigationContext-negative-5a0.tsx'))
manifest.inputSha256['apps/electron/src/renderer/contexts/NavigationContext.tsx'] = sha256(oldSource)
Object.assign(manifest, {negativeControl: {path:'apps/electron/src/renderer/contexts/NavigationContext.tsx', sourceRevision:'5a0b769b894aed2ed09ba8bcbe01a41cf8149d76', sourceSha256:sha256(oldSource), description:'Only NavigationContext is replaced by the exact old committed production source. All fixture callbacks and other inputs use the final candidate.'}})
writeFileSync(output + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ sourceRevision: manifest.sourceRevision, lane, output, inputCount: sourceInputs.length, bytes: Buffer.byteLength(bundle) }))
