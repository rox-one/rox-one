import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

interface NativeRegistrationInput {
  isPackaged?: boolean
  defaultApp?: boolean
  argv?: string[]
  scheme?: string
  optOut?: string
  register?: (scheme: string, executable?: string, args?: string[]) => boolean
}

/** Execute the exact product registration block, replacing only the OS operation. */
function registration(input: NativeRegistrationInput = {}) {
  const path = join(import.meta.dir, '../apps/electron/src/main/index.ts')
  const source = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = file.statements.filter(node => ts.isFunctionDeclaration(node)
    && node.name?.text === 'registerDeeplinkScheme')
  function callsRegistration(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'registerDeeplinkScheme') return true
    let found = false
    ts.forEachChild(node, child => { found ||= callsRegistration(child) })
    return found
  }
  const invocations = file.statements.filter(node => !ts.isFunctionDeclaration(node)
    && (ts.isExpressionStatement(node) || ts.isIfStatement(node)) && callsRegistration(node))
  if (declarations.length !== 1 || invocations.length !== 2) throw new Error('Product registration block unavailable')
  const program = ts.transpileModule([...declarations, ...invocations].map(node => node.getText(file)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const calls: unknown[][] = []
  const app = {
    isPackaged: input.isPackaged ?? false,
    setAsDefaultProtocolClient(scheme: string, executable?: string, args?: string[]) {
      calls.push(args === undefined ? [scheme] : [scheme, executable, args])
      return input.register?.(scheme, executable, args) ?? true
    },
  }
  const processBoundary = {
    defaultApp: input.defaultApp ?? true,
    argv: input.argv ?? ['task-electron', '/task/candidate/apps/electron'],
    execPath: '/task/runtime/Electron.app/Contents/MacOS/Electron',
    env: { ROX_DEV_DISABLE_PROTOCOL_REGISTRATION: input.optOut },
  }
  return {
    calls,
    run: () => new Function('app', 'process', 'DEEPLINK_SCHEME', 'LEGACY_DEEPLINK_SCHEME', program)(
      app, processBoundary, input.scheme ?? 'rox', 'craftagents',
    ),
  }
}

describe('UI-001 native protocol isolation', () => {
  it('explicit isolated dev opt-out prevents every OS association callback', () => {
    const execution = registration({ optOut: '1', register: () => { throw new Error('Unexpected global association') } })
    expect(execution.run).not.toThrow()
    expect(execution.calls).toEqual([])
  })

  it('default dev startup registers primary and legacy schemes with the actual executable and app argument', () => {
    const execution = registration()
    execution.run()
    expect(execution.calls).toEqual([
      ['rox', '/task/runtime/Electron.app/Contents/MacOS/Electron', ['/task/candidate/apps/electron']],
      ['craftagents', '/task/runtime/Electron.app/Contents/MacOS/Electron', ['/task/candidate/apps/electron']],
    ])
  })

  it('packaged startup preserves both OS aliases even if the isolated dev flag is present', () => {
    const execution = registration({ isPackaged: true, defaultApp: false, optOut: '1' })
    execution.run()
    expect(execution.calls).toEqual([['rox'], ['craftagents']])
  })

  it('a custom isolated scheme leaves the legacy alias intact by default', () => {
    const execution = registration({ scheme: 'rox-ui001-task' })
    execution.run()
    expect(execution.calls).toEqual([
      ['rox-ui001-task', '/task/runtime/Electron.app/Contents/MacOS/Electron', ['/task/candidate/apps/electron']],
      ['craftagents', '/task/runtime/Electron.app/Contents/MacOS/Electron', ['/task/candidate/apps/electron']],
    ])
  })

  it('the configured legacy scheme is registered once', () => {
    const execution = registration({ scheme: 'craftagents', defaultApp: false })
    execution.run()
    expect(execution.calls).toEqual([['craftagents']])
  })

  for (const value of ['', '0', 'true', 'yes', ' 1']) {
    it(`non-explicit opt-out ${JSON.stringify(value)} retains OS registrations`, () => {
      const execution = registration({ optOut: value, defaultApp: false })
      execution.run()
      expect(execution.calls).toEqual([['rox'], ['craftagents']])
    })
  }

  it('dev runtime without an app argv does not register an incomplete launch target', () => {
    const execution = registration({ argv: ['task-electron'] })
    execution.run()
    expect(execution.calls).toEqual([])
  })

  it('an OS registration refusal does not turn into a retry or skip the other alias', () => {
    const execution = registration({ defaultApp: false, register: () => false })
    expect(execution.run).not.toThrow()
    expect(execution.calls).toEqual([['rox'], ['craftagents']])
  })

  it('an OS registration exception propagates without unexpected further global operations', () => {
    const execution = registration({ defaultApp: false, register: () => { throw new Error('OS registration denied') } })
    expect(execution.run).toThrow('OS registration denied')
    expect(execution.calls).toEqual([['rox']])
  })
})
