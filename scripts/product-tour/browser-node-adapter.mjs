// Test-only Node adapter. The bundled test file retains its original assertions,
// production imports, explicit case timeouts, and controlled renderer fixture.
import { test as nodeTest, describe as nodeDescribe, before, after } from 'node:test'
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, readdirSync } from 'node:fs'
import { promisify } from 'node:util'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'

const read = promisify(readFile)
export { expect }
export const test = (name, run, timeout = 30_000) => nodeTest(name, { timeout }, run)
export const it = test
export const beforeAll = (run, timeout = 30_000) => before(run, { timeout })
export const afterAll = (run, timeout = 30_000) => after(run, { timeout })
export const describe = (name, run) => nodeDescribe(name, run)
describe.skipIf = skip => (name, run) => nodeDescribe(name, { skip }, run)

globalThis.Bun = {
  sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  file: path => ({ text: () => read(path, 'utf8'), json: async () => JSON.parse(await read(path, 'utf8')) }),
  Glob: class {
    constructor(pattern) { this.pattern = pattern }
    *scanSync({ cwd }) {
      if (this.pattern !== '*.json') throw new Error(`Unsupported test-only glob: ${this.pattern}`)
      yield* readdirSync(cwd).filter(name => name.endsWith('.json'))
    }
  },
  serve({ hostname = '127.0.0.1', port = 0, fetch: respond }) {
    const server = createServer(async (request, response) => {
      try {
        const result = await respond(new Request(new URL(request.url, `http://${hostname}:${server.address().port}`)))
        response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
        response.end(Buffer.from(await result.arrayBuffer()))
      } catch { response.writeHead(500); response.end('Test-only renderer fixture response failed') }
    })
    server.listen(port, hostname)
    return {
      get url() { return new URL(`http://${hostname}:${server.address().port}`) },
      stop(force) { if (force) server.closeAllConnections(); server.close() },
    }
  },
  spawn(command, options = {}) {
    // Original isolated Bun tests recursively select one case in this same bundle.
    // Change only the test runner, preserving the original environment/case selector.
    const isolated = command[1] === 'test'
    const args = isolated ? ['--test', '--test-reporter=tap', process.env.ROX_PRODUCT_TOUR_NODE_BUNDLE] : command.slice(1)
    const env = { ...(options.env ?? process.env) }
    // Node's parent test IPC context is private to that runner. Inheriting it can
    // make a nested runner exit successfully without executing its selected case.
    delete env.NODE_TEST_CONTEXT
    const child = spawn(command[0], args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let report = ''
    child.stdout.on('data', chunk => { report = (report + chunk).slice(-65_536) })
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => setImmediate(() => {
        if (isolated && code === 0 && (!/# tests 1\b/.test(report) || !/# pass 1\b/.test(report) || !/# fail 0\b/.test(report))) {
          reject(new Error(`Selected browser child did not execute exactly one passing test:\n${report}`))
        } else resolve(code ?? (signal === 'SIGTERM' ? 143 : 137))
      }))
    })
    return { stdout: Readable.toWeb(child.stdout), stderr: Readable.toWeb(child.stderr), exited,
      kill: signal => child.kill(signal ?? 'SIGTERM') }
  },
}
