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
    const args = command[1] === 'test' ? ['--test', process.env.ROX_PRODUCT_TOUR_NODE_BUNDLE] : command.slice(1)
    const child = spawn(command[0], args, { env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGTERM' ? 143 : 137)))
    })
    return { stdout: Readable.toWeb(child.stdout), stderr: Readable.toWeb(child.stderr), exited,
      kill: signal => child.kill(signal ?? 'SIGTERM') }
  },
}
