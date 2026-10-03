import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// Execute the production ingress callbacks and pending replay block without
// registering OS protocols or starting Electron or a provider transport.
const source = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const callbacks = new Map<string, ts.Node>()
let replay: ts.IfStatement | undefined
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'app.on'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
    const name = node.arguments[0].text
    if (name === 'second-instance' || name === 'open-url') callbacks.set(name, node.arguments[1]!)
  }
  if (ts.isIfStatement(node) && node.expression.getText(ast) === 'pendingDeepLink') replay = node
  ts.forEachChild(node, visit)
}
visit(ast)
if (!callbacks.has('second-instance') || !callbacks.has('open-url') || !replay) {
  throw new Error('Actual deep-link ingress or startup replay missing')
}
const executable = ts.transpileModule(`
  let pendingDeepLink = null;
  const second = ${callbacks.get('second-instance')!.getText(ast)};
  const open = ${callbacks.get('open-url')!.getText(ast)};
  return { second, open, pending: () => pendingDeepLink,
    ready(manager) { windowManager = manager; },
    async replay() { ${replay.getText(ast)} }
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

function fixture() {
  const calls: unknown[][] = [], errors: unknown[][] = []
  const sink = {}, resolver = {}
  let rejected: Error | undefined
  const ingress = new Function('windowManager', 'DEEPLINK_SCHEME', 'LEGACY_DEEPLINK_SCHEME',
    'mainLog', 'handleDeepLink', 'moduleSink', 'moduleClientResolver', executable)(
    null, 'rox', 'craftagents', { info() {}, error: (...args: unknown[]) => errors.push(args) },
    (...args: unknown[]) => { calls.push(args); return rejected ? Promise.reject(rejected) : Promise.resolve() },
    sink, resolver,
  ) as { second(event: unknown, commandLine: string[], workingDirectory: string): void;
    open(event: { preventDefault(): void }, url: string): void;
    pending(): string | null; ready(manager: unknown): void; replay(): Promise<void> }
  return { ...ingress, calls, errors, sink, resolver,
    reject(error?: Error) { rejected = error },
    secondUrl(url: string) { ingress.second({}, ['rox.exe', '--flag', url], '.') } }
}

describe('UI-001 actual second-instance startup deep-link ingress', () => {
  test.each(['rox', 'craftagents'])('retains %s URL while the window manager is unavailable and replays once', async scheme => {
    const f = fixture(), manager = {}, url = `${scheme}://workspace/ws-a/notes/note/actual?keep=keep%20me`
    f.secondUrl(url)
    expect(f.pending()).toBe(url)
    expect(f.calls).toEqual([])
    f.ready(manager); await f.replay(); await f.replay()
    expect(f.calls).toEqual([[url, manager, f.sink, f.resolver]])
    expect(f.pending()).toBeNull()
  })

  test('latest startup link wins across macOS and second-instance callbacks', async () => {
    const f = fixture(); let prevented = false
    f.secondUrl('craftagents://old')
    f.open({ preventDefault() { prevented = true } }, 'rox://middle')
    f.secondUrl('rox://latest?view=notes%2Fnote%2Factual')
    expect(prevented).toBe(true)
    expect(f.pending()).toBe('rox://latest?view=notes%2Fnote%2Factual')
    f.ready({}); await f.replay()
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]![0]).toBe('rox://latest?view=notes%2Fnote%2Factual')
  })

  test('ready ingress dispatches immediately and logs an actual rejected callback', async () => {
    const f = fixture(), manager = {}, failure = new Error('transport unavailable')
    f.ready(manager); f.secondUrl('rox://current')
    expect(f.calls).toEqual([['rox://current', manager, f.sink, f.resolver]])
    expect(f.pending()).toBeNull()
    f.reject(failure); f.secondUrl('craftagents://refused')
    await Promise.resolve(); await Promise.resolve()
    expect(f.errors).toEqual([['Failed to handle deep link:', failure]])
  })

  test('failed startup replay retains its URL until a successful retry', async () => {
    const f = fixture(), failure = new Error('not ready')
    f.secondUrl('rox://retry'); f.ready({}); f.reject(failure)
    await expect(f.replay()).rejects.toThrow('not ready')
    expect(f.pending()).toBe('rox://retry')
    f.reject(); await f.replay()
    expect(f.pending()).toBeNull()
    expect(f.calls).toHaveLength(2)
  })

  test('a launch without a protocol URL focuses and restores the existing first window', () => {
    const f = fixture(), events: string[] = []
    f.second({}, ['rox.exe', 'https://example.invalid/rox'], '.')
    expect(f.pending()).toBeNull()
    f.ready({ getAllWindows: () => [{ window: {
      isMinimized: () => true, restore: () => events.push('restore'), focus: () => events.push('focus'),
    } }] })
    f.second({}, ['rox.exe'], '.')
    expect(events).toEqual(['restore', 'focus'])
    expect(f.calls).toEqual([])
  })
})
