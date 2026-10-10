import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import configFn from '../../vite.config'

type Handler = (html: string, ctx: Record<string, unknown>) => Array<{ tag: string; attrs: Record<string, unknown> }> | undefined

/** The subset of a Vite plugin this test drives. */
type LoaderPlugin = {
  name: string
  transformIndexHtml: { order?: 'pre' | 'post' | null; handler: Handler }
}

const PLUGIN_NAME = 'rox-modulepreload-main-chunk'
// The config is a function of the build environment; resolve it for a build
// (the plugin under test has `apply: 'build'`).
const config = configFn({ command: 'build', mode: 'production' })
const flatPlugins: readonly unknown[] = (config.plugins ?? []).flat()
const plugin = flatPlugins.find(
  (p): p is LoaderPlugin => !!p && typeof p === 'object' && 'name' in p && p.name === PLUGIN_NAME,
)
const renderer = join(import.meta.dir, '..', 'renderer')
const chunk = (fileName: string, extra: Record<string, unknown> = {}) => ({
  type: 'chunk', fileName, imports: [], moduleIds: [], isDynamicEntry: false, facadeModuleId: null,
  viteMetadata: { importedCss: new Set<string>() }, ...extra,
})

describe('modulepreload of the main chunk (parallel with the locale load)', () => {
  const bundle = {
    'assets/main-boot.js': chunk('assets/main-boot.js', { imports: ['assets/vendor-react.js'], moduleIds: [join(renderer, 'bootstrap.ts')] }),
    'assets/main-app.js': chunk('assets/main-app.js', {
      isDynamicEntry: true,
      moduleIds: [join(renderer, 'App.tsx'), join(renderer, 'main.tsx')],
      imports: ['assets/vendor-react.js', 'assets/ui.js'],
      viteMetadata: { importedCss: new Set(['assets/main-app.css']) },
    }),
    'assets/ui.js': chunk('assets/ui.js', { imports: ['assets/vendor-react.js'] }),
    'assets/vendor-react.js': chunk('assets/vendor-react.js'),
    'assets/ru.js': chunk('assets/ru.js', { isDynamicEntry: true }),
  }
  const html = '<script type="module" crossorigin src="./assets/main-boot.js"></script><link rel="modulepreload" crossorigin href="./assets/vendor-react.js">'

  it('preloads main and its static closure (not lazy chunks) without evaluating them', () => {
    expect(plugin?.transformIndexHtml.order).toBe('post')
    const tags = plugin!.transformIndexHtml.handler(html, { filename: join(renderer, 'index.html'), bundle })!
    expect(tags.map(t => [t.attrs.rel, t.attrs.href]).sort()).toEqual([
      ['modulepreload', './assets/main-app.js'],
      ['modulepreload', './assets/ui.js'],
      ['preload', './assets/main-app.css'],
    ])
    // Never a <script>: preloading must not run main before i18n is ready.
    expect(tags.every(t => t.tag === 'link')).toBe(true)
  })

  it('leaves the other HTML entries alone', () => {
    expect(plugin!.transformIndexHtml.handler(html, { filename: join(renderer, 'browser-toolbar.html'), bundle })).toBeUndefined()
  })
})
