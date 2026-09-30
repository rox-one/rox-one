import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const repositoryRoot = resolve(import.meta.dir, '../../..')

describe('WebUI browser builtins bundle', () => {
  it('cold-imports the real renderer stub with a working browser Buffer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-webui-builtins-'))
    try {
      // Exercise the production resolver, including its Node builtin mappings.
      // Compiling only the actual stub keeps this regression independent of the
      // app's runtime services while retaining the resolver that caused the TDZ.
      const bundled = await build({
        configFile: join(repositoryRoot, 'apps/webui/vite.config.ts'),
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          sourcemap: false,
          lib: {
            entry: join(repositoryRoot, 'apps/electron/src/renderer/shims/node-stub.ts'),
            formats: ['es'],
          },
          rollupOptions: {
            input: join(repositoryRoot, 'apps/electron/src/renderer/shims/node-stub.ts'),
          },
        },
      })
      const outputs = Array.isArray(bundled) ? bundled : [bundled]
      const chunk = outputs.flatMap(output => output.output).find(output => output.type === 'chunk' && output.isEntry)
      if (!chunk || chunk.type !== 'chunk') throw new Error('WebUI production resolver produced no entry chunk')
      const bundlePath = join(root, 'node-stub.mjs')
      writeFileSync(bundlePath, chunk.code)
      const privateFile = join(root, 'private-host-file.txt')
      const forbiddenWrite = join(root, 'browser-must-not-write.txt')
      const forbiddenCopy = join(root, 'browser-must-not-copy.txt')
      const forbiddenExec = join(root, 'browser-must-not-exec.txt')
      writeFileSync(privateFile, 'PRIVATE_HOST_FIXTURE')
      const child = Bun.spawn(['node', '--input-type=module', '-e', `
        const { Buffer, existsSync, readFileSync, writeFileSync, copyFileSync, execFileSync, randomBytes } = await import(${JSON.stringify(pathToFileURL(bundlePath).href)});
        const value = Buffer.from('cloud π', 'utf8');
        if (value.toString('base64') !== 'Y2xvdWQgz4A=') throw new Error('Browser Buffer roundtrip failed');
        if (Buffer.alloc(3).toString('hex') !== '000000') throw new Error('Browser Buffer allocation failed');
        if (existsSync(${JSON.stringify(privateFile)}) !== false) throw new Error('Browser stub exposed host file existence');
        if (readFileSync(${JSON.stringify(privateFile)}, 'utf8') !== '') throw new Error('Browser stub read host data');
        writeFileSync(${JSON.stringify(forbiddenWrite)}, 'unexpected write');
        copyFileSync(${JSON.stringify(privateFile)}, ${JSON.stringify(forbiddenCopy)});
        execFileSync('node', ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(forbiddenExec)}, 'unexpected exec')`)}]);
        if (randomBytes(32) !== undefined) throw new Error('Browser stub manufactured cryptographic authority');
        const hostFs = await import('node:fs');
        for (const file of ${JSON.stringify([forbiddenWrite, forbiddenCopy, forbiddenExec])}) {
          if (hostFs.existsSync(file)) throw new Error('Browser stub performed an unsupported host action');
        }
        console.log('BROWSER_BUFFER_READY');
      `], {
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' })
      expect(stdout.trim()).toBe('BROWSER_BUFFER_READY')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  it('refuses a browser bundle that requests an unavailable native SQLite API', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rox-webui-unavailable-builtin-'))
    try {
      const entry = join(root, 'native-sqlite.ts')
      writeFileSync(entry, "import { DatabaseSync } from 'node:sqlite'; export const database = new DatabaseSync(':memory:')")
      await expect(build({
        configFile: join(repositoryRoot, 'apps/webui/vite.config.ts'),
        logLevel: 'silent',
        build: {
          write: false,
          lib: { entry, formats: ['es'] },
          rollupOptions: { input: entry },
        },
      })).rejects.toThrow(/DatabaseSync.*not exported/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
