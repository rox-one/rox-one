import { describe, expect, it } from 'bun:test'
import { join, resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { build } from 'vite'

const repositoryRoot = resolve(import.meta.dir, '../../..')

describe('WebUI browser bootstrap', () => {
  it('installs browser globals in a cold JavaScript realm before shared initializers', async () => {
    const entry = join(repositoryRoot, 'apps/webui/src/browser-globals.ts')
    const bundled = await build({
      configFile: join(repositoryRoot, 'apps/webui/vite.config.ts'),
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        sourcemap: false,
        lib: { entry, name: 'RoxBrowserGlobals', formats: ['iife'] },
        rollupOptions: { input: entry },
      },
    })
    const outputs = Array.isArray(bundled) ? bundled : [bundled]
    const chunk = outputs.flatMap(output => output.output).find(output => output.type === 'chunk' && output.isEntry)
    if (!chunk || chunk.type !== 'chunk') throw new Error('WebUI bootstrap produced no entry chunk')
    // This realm has ECMAScript intrinsics but no ambient Node Buffer/process.
    // It tests the real production bundle rather than Node's existing globals.
    const realm = createContext({})
    expect(runInContext('typeof Buffer', realm)).toBe('undefined')
    runInContext(chunk.code, realm)
    const actual = runInContext(`({
      magic: Buffer.from('CRAFT01\\0').toString('hex'),
      globalAlias: global === globalThis,
      processNextTick: typeof process.nextTick,
      processEnv: Object.keys(process.env).length,
    })`, realm)
    expect(JSON.parse(JSON.stringify(actual))).toEqual({
      magic: '4352414654303100',
      globalAlias: true,
      processNextTick: 'function',
      processEnv: 0,
    })
  }, 20_000)
})
