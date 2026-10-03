import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import ts from 'typescript'

const root = resolve(import.meta.dir, '../../../../..')
const temp = mkdtempSync(join(import.meta.dir, 'rox-readiness-ui-001-proposal-temp-'))
const patch = resolve(import.meta.dir, process.argv[2] ?? 'lead-route-parser-proposal.patch')
const paths = ['apps/electron/src/shared/route-parser.ts', 'apps/electron/src/shared/types.ts', 'apps/electron/src/renderer/lib/nav-helpers.ts', 'apps/electron/src/renderer/contexts/NavigationContext.tsx']
const digest = (contents: string | Buffer) => createHash('sha256').update(contents).digest('hex')
const unchanged = Object.fromEntries(paths.map(path => [path, digest(readFileSync(resolve(root, path)))]))
const env = { ...process.env, GIT_INDEX_FILE: join(temp, 'candidate-index') }
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' })
const results: Array<{ name: string; pass: boolean; error?: string }> = []
function check(name: string, callback: () => void) {
  try { callback(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }) }
}
async function checkAsync(name: string, callback: () => Promise<void>) {
  try { await callback(); results.push({ name, pass: true }) }
  catch (error) { results.push({ name, pass: false, error: String(error) }) }
}
try {
  git('read-tree', 'HEAD')
  git('apply', '--cached', '--check', '--whitespace=nowarn', patch)
  git('apply', '--cached', '--whitespace=nowarn', patch)
  const proposedPaths = git('diff', '--cached', '--name-only').trim().split('\n').filter(Boolean)
  for (const path of proposedPaths) unchanged[path] = digest(readFileSync(resolve(root,path)))
  const overlay = new Map([...new Set([...paths,...proposedPaths])].map(path => [resolve(root, path), git('show', `:${path}`)]))
  const entry = resolve(temp, 'rox-readiness-ui-001.proposal.bundle.mjs')
  await build({
    stdin: { contents: `export {parseRouteToNavigationState,buildRouteFromNavigationState,parseCompoundRoute,parseRoute} from ${JSON.stringify(resolve(root,paths[0]!))}; export {getNavigationStateKey,parseNavigationStateKey,isSessionsNavigation} from ${JSON.stringify(resolve(root,paths[1]!))}; export {isDetailNavState} from ${JSON.stringify(resolve(root,paths[2]!))};`, resolveDir: root, loader: 'ts' },
    outfile: entry, bundle: true, platform: 'node', format: 'esm', target: 'es2022',
    plugins: [{ name: 'unapplied candidate overlay', setup(builder) {
      builder.onLoad({ filter: /\.(tsx?|mts)$/ }, args => {
        const contents = overlay.get(resolve(args.path))
        return contents === undefined ? undefined : { contents, loader: 'ts', resolveDir: dirname(args.path) }
      })
    } }],
  })
  const candidate = await import(entry)
  for (const route of ['unknown-surface/one', 'knowledge/unknown-kind/one', 'knowledge/document/%E0%A4%A']) {
    check(`Unavailable route ${route} retains its raw identity`, () => {
      const state = candidate.parseRouteToNavigationState(route)
      assert.equal(state.navigator, 'unavailable')
      assert.equal(candidate.buildRouteFromNavigationState(state), route)
    })
    check(`Unavailable route ${route} survives a persisted panel key`, () => {
      const state = candidate.parseRouteToNavigationState(route)
      assert.deepEqual(candidate.parseNavigationStateKey(candidate.getNavigationStateKey(state)), state)
    })
  }
  for (const route of ['allSessions/session/one', 'sources/source/one', 'skills/skill/one', 'projects/project/one', 'notes/note/one', 'pages/page/one', 'knowledge/document/one', 'extension/one/view', 'terminal/one', 'cloud-run/one', 'dossier/item/one', 'radar/item/one', 'decisions/item/one', 'agents/item/one', 'focus/item/one']) {
    check(`Canonical candidate route round-trip ${route}`, () => {
      assert.equal(candidate.buildRouteFromNavigationState(candidate.parseRouteToNavigationState(route)), route)
    })
  }
  check('Action routes keep their side-effect-only navigation contract', () => assert.equal(candidate.parseRouteToNavigationState('action/new-session'), null))
  check('Retired Notes route keeps its own unavailable identity', () => {
    assert.equal(candidate.parseCompoundRoute('notes-legacy/note/foo'),null)
    assert.deepEqual(candidate.parseRouteToNavigationState('notes-legacy/note/foo'),{
      navigator: 'unavailable', route: 'notes-legacy/note/foo', reason: 'unsupported-route',
    })
  })
  check('Malformed persisted unavailable keys fail safely without a decode exception', () => {
    assert.equal(candidate.parseNavigationStateKey('unavailable:unsupported-route:%E0%A4%A'),null)
  })
  check('Unavailable routes stay visible as compact detail surfaces', () => assert.equal(candidate.isDetailNavState(candidate.parseRouteToNavigationState('unknown-surface/one')), true))
  check('Canonical session identities survive their emitted legacy panel key', () => {
    const state = candidate.parseRouteToNavigationState('allSessions/session/one')
    // Omitted optional slots and explicit undefined slots have the same identity.
    const identity = (value: unknown) => JSON.parse(JSON.stringify(value))
    assert.deepEqual(identity(candidate.parseNavigationStateKey(candidate.getNavigationStateKey(state))), identity(state))
    assert.deepEqual(identity(candidate.parseNavigationStateKey('allSessions/session/one')), identity(state))
  })
  const contextSource = ts.createSourceFile('NavigationContext.tsx', overlay.get(resolve(root,paths[3]!))!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks = new Map<string,ts.Expression>()
  const effects: ts.Expression[] = []
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.arguments[0]) callbacks.set(node.name.getText(contextSource),node.initializer.arguments[0])
    if (ts.isCallExpression(node) && node.expression.getText(contextSource) === 'useEffect' && node.arguments[0]) effects.push(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  visit(contextSource)
  const resolver = callbacks.get('resolveAutoSelection')
  if (!resolver) throw new Error('Candidate resolveAutoSelection not found')
  const resolverCode = ts.transpileModule(`return (${resolver.getText(contextSource)})(newState)`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  function selection(state: unknown, metadata: Map<string, unknown>, remoteWorkspaceId: string | null = null) {
    const bindings = {
      isSessionsNavigation: candidate.isSessionsNavigation,
      buildRouteFromNavigationState: candidate.buildRouteFromNavigationState,
      store: { get: () => metadata }, sessionMetaMapAtom: {}, workspaceId: 'workspace-a', remoteWorkspaceId,
      getLastSelectedSessionId: () => null, getFirstSessionId: () => 'unrelated-session', newState: state,
    }
    return Function(...Object.keys(bindings), resolverCode)(...Object.values(bindings))
  }
  const explicit = candidate.parseRouteToNavigationState('allSessions/session/requested')
  check('Explicit missing session identity is retained through empty metadata', () => assert.deepEqual(selection(explicit,new Map()),explicit))
  check('Deleted explicit sessions do not become another available session', () => assert.deepEqual(selection(explicit,new Map([['unrelated-session',{workspaceId:'workspace-a'}]])),explicit))
  check('Foreign-workspace session metadata becomes its own unavailable route', () => {
    const state = selection(explicit,new Map([['requested',{workspaceId:'foreign'}]]))
    assert.equal(state.navigator,'unavailable')
    assert.equal(state.reason,'workspace-mismatch')
    assert.equal(state.route,'allSessions/session/requested')
    assert.deepEqual(candidate.parseNavigationStateKey(candidate.getNavigationStateKey(state)),state)
  })
  check('Local and remote aliases keep valid explicit session identity', () => {
    assert.deepEqual(selection(explicit,new Map([['requested',{workspaceId:'workspace-a'}]])),explicit)
    assert.deepEqual(selection(explicit,new Map([['requested',{workspaceId:'remote-a'}]]),'remote-a'),explicit)
  })
  check('List-only session routes retain their existing auto-selection', () => {
    const state = selection(candidate.parseRouteToNavigationState('allSessions'),new Map())
    assert.equal(state.details.sessionId,'unrelated-session')
  })
  function execute(callback: ts.Expression, bindings: Record<string,unknown>, args: unknown[] = []) {
    const source = ts.transpileModule(`return (${callback.getText(contextSource)})(...callbackArgs)`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
    return Function(...Object.keys(bindings),'callbackArgs',source)(...Object.values(bindings),args)
  }
  function navigationHarness(metadata = new Map<string,unknown>()) {
    let focusedRoute = 'sources/source/previous'
    const pendingNavigationRef = { current: null as unknown }
    const actionCalls: unknown[] = [], pushed: unknown[] = []
    const common = {
      parseRoute: candidate.parseRoute, parseRouteToNavigationState: candidate.parseRouteToNavigationState,
      buildRouteFromNavigationState: candidate.buildRouteFromNavigationState, isSessionsNavigation: candidate.isSessionsNavigation,
      resolveAutoSelection: (state: unknown) => selection(state,metadata), suppressAutoSelectRef: { current: false },
      pendingNavigationRef, handleActionNavigation: async (parsed: unknown) => { actionCalls.push(parsed) },
      pushPanel: (entry: unknown) => { pushed.push(entry) }, storage: { KEYS: { lastSelectedSessionId: 'last' }, set: () => {} },
      workspaceId: 'workspace-a', store: { set: (_atom: unknown,route: string) => { focusedRoute = route } },
      updateFocusedPanelRouteAtom: {}, setNavigationRevision: () => {},
    }
    const request = (route: string,options?: unknown,isReady = true) => execute(callbacks.get('navigate')!,{ ...common,isReady },[route,options]) as Promise<void>
    const flush = async () => {
      const effect = effects.find(node => node.getText(contextSource).includes('const pending = pendingNavigationRef.current'))!
      execute(effect,{ ...common,isReady: true,navigate: request })
      await Promise.resolve()
    }
    const state = () => execute(callbacks.get('navigationState')!,{
      focusedRoute,rightSidebar: undefined,DEFAULT_NAVIGATION_STATE: { navigator:'sessions',sessionFilter:{kind:'allSessions'},details:null },
      parseRouteToNavigationState: candidate.parseRouteToNavigationState,isSessionsNavigation: candidate.isSessionsNavigation,
      workspaceId:'workspace-a',remoteWorkspaceId:null,sessionMetaMap:metadata,
    })
    return { request,flush,state,pendingNavigationRef,actionCalls,pushed,route: () => focusedRoute,common }
  }
  await checkAsync('Actual navigate callback opens an unsupported raw route as unavailable', async () => {
    const nav = navigationHarness(); await nav.request('unknown-surface/one')
    assert.equal(nav.route(),'unknown-surface/one'); assert.equal(nav.state().navigator,'unavailable')
  })
  await checkAsync('Actual navigate callback contains malformed percent encoding', async () => {
    const nav = navigationHarness(); await nav.request('knowledge/document/%E0%A4%A')
    assert.equal(nav.route(),'knowledge/document/%E0%A4%A'); assert.equal(nav.state().reason,'invalid-encoding')
  })
  await checkAsync('Queued canonical view retains the complete route and navigation options', async () => {
    const nav = navigationHarness(); const options = { newPanel:true,targetLaneId:'main' }
    await nav.request('sources/source/folder%2Fone',options,false)
    assert.deepEqual(nav.pendingNavigationRef.current,{route:'sources/source/folder%2Fone',options})
    await nav.flush(); assert.deepEqual(nav.pushed,[{route:'sources/source/folder%2Fone',targetLaneId:'main',intent:'explicit'}])
  })
  await checkAsync('Queued unsupported view opens after readiness without another session', async () => {
    const nav = navigationHarness(); await nav.request('unknown-surface/one',undefined,false); await nav.flush()
    assert.equal(nav.route(),'unknown-surface/one'); assert.equal(nav.state().navigator,'unavailable')
  })
  await checkAsync('Known foreign session stays unavailable when focused state is derived again', async () => {
    const nav = navigationHarness(new Map([['requested',{workspaceId:'foreign'}]]))
    await nav.request('allSessions/session/requested')
    assert.equal(nav.route(),'allSessions/session/requested'); assert.equal(nav.state().navigator,'unavailable')
    assert.equal(nav.state().reason,'workspace-mismatch')
  })
  await checkAsync('Actual deep-link subscription forwards unavailable route and cleans up', async () => {
    const nav = navigationHarness(); let listener: ((event: unknown) => void) | undefined; let cleaned = false
    const effect = effects.find(node => node.getText(contextSource).includes('onDeepLinkNavigate'))!
    const cleanup = execute(effect,{
      workspaceId:'workspace-a',window:{electronAPI:{onDeepLinkNavigate:(cb: (event: unknown) => void) => {listener=cb;return () => {cleaned=true}}}},
      parseRouteToNavigationState:candidate.parseRouteToNavigationState,navigate:nav.request,toast:{error:()=>{throw new Error('unexpected invalid-link toast')}},t:(key:string)=>key,
    })
    listener!({view:'unknown-surface/from-deep-link'}); await Promise.resolve()
    assert.equal(nav.route(),'unknown-surface/from-deep-link'); assert.equal(nav.state().navigator,'unavailable')
    cleanup(); assert.equal(cleaned,true)
  })
  await checkAsync('Actions still execute once and queued actions preserve their parameters', async () => {
    const nav = navigationHarness(); await nav.request('action/copy?text=hello')
    assert.equal(nav.actionCalls.length,1); assert.equal((nav.actionCalls[0] as any).params.text,'hello')
    await nav.request('action/copy?text=later',undefined,false); assert.equal(nav.actionCalls.length,1)
    await nav.flush(); assert.equal(nav.actionCalls.length,2); assert.equal((nav.actionCalls[1] as any).params.text,'later')
    assert.equal(nav.route(),'sources/source/previous')
  })
  const regressionFiles = execFileSync('rg', ['--files', 'apps/electron/src/shared/__tests__', 'apps/electron/src/renderer/contexts/__tests__'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
    .filter(path => /route-parser-.*\.test\.ts$/.test(path) || /navigation-(reconcile|history-key)\.test\.ts$/.test(path))
  const regressionDir = resolve(temp, 'regression')
  await build({
    entryPoints: regressionFiles.map(path => resolve(root,path)), outdir: regressionDir,
    entryNames: 'rox-readiness-ui-001.[name]', bundle: true, platform: 'node', format: 'esm', target: 'es2022',
    external: ['bun:test', 'react', 'jotai', 'jotai/*'],
    plugins: [{ name: 'candidate regression overlay', setup(builder) {
      builder.onLoad({ filter: /\.(tsx?|mts)$/ }, args => {
        const virtual = overlay.get(resolve(args.path))
        const source = virtual ?? readFileSync(args.path, 'utf8')
        const contents = source.replaceAll('import.meta.dir', JSON.stringify(dirname(args.path))).replaceAll('import.meta.url', JSON.stringify(new URL(`file://${args.path}`).href))
        return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(args.path) }
      })
    } }],
  })
  const regression = spawnSync(process.execPath, ['test', regressionDir], { cwd: root, encoding: 'utf8' })
  console.log(regression.stdout, regression.stderr)
  check('Existing parser/history regression tests under the virtual candidate', () => assert.equal(regression.status,0))
  const configPath = resolve(root, 'apps/electron/tsconfig.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath))
  const host = ts.createCompilerHost(parsed.options)
  const originalRead = host.readFile.bind(host)
  const originalSource = host.getSourceFile.bind(host)
  host.readFile = path => overlay.get(resolve(path)) ?? originalRead(path)
  host.getSourceFile = (path, language, onError, fresh) => {
    const contents = overlay.get(resolve(path))
    return contents === undefined ? originalSource(path, language, onError, fresh) : ts.createSourceFile(path, contents, language)
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, host })
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({
    code: diagnostic.code,
    file: diagnostic.file ? diagnostic.file.fileName.slice(root.length + 1) : undefined,
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }))
  check('Full Electron typecheck with virtual parser/types overlay', () => assert.equal(diagnostics.length, 0))
  for (const [path, sha] of Object.entries(unchanged)) assert.equal(digest(readFileSync(resolve(root,path))), sha)
  console.log(JSON.stringify({ scope: 'unapplied lead proposal only; patch is held in a temporary Git index and virtual compiler/bundler modules; actual shared source and existing tests are unchanged; no runtime/native integration', patch: patch.slice(root.length + 1), patchSha256: digest(readFileSync(patch)), proposedPaths, candidateSourceSha256: Object.fromEntries(proposedPaths.map(path => [path, digest(overlay.get(resolve(root,path))!)])), actualSourceUnchanged: unchanged, regression: { files: regressionFiles, proposedTestUpdates: proposedPaths.filter(path => path.includes('/__tests__/')), exitCode: regression.status }, results, diagnostics }, null, 2))
  if (results.some(result => !result.pass)) process.exitCode = 1
} finally { rmSync(temp, { recursive: true, force: true }) }
