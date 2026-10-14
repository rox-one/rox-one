/** Keep module-URL consumers valid when Electron main is bundled as CommonJS. */
export const ELECTRON_MAIN_CJS_FLAGS = [
  '--define:import.meta.url=__roxElectronMainBundleFileUrl',
  '--banner:js=var __roxElectronMainBundleFileUrl = require("node:url").pathToFileURL(__filename).href;',
] as const

/**
 * Heavy dependencies split out of main.cjs (perf audit: main.cjs was 64.8 MB and took ~550 ms to
 * evaluate). Each is built to dist/vendor/<file>; main.cjs aliases the package to that relative path
 * and keeps it external, and every call site imports it lazily, so it is parsed only on first use.
 * dist/** is packaged (electron-builder `files`), so the vendor files ship next to main.cjs.
 */
export const MAIN_VENDOR_BUNDLES = [
  // `load`: how main.cjs reaches the file. A source-level `await import(pkg)` stays a native import()
  // (named exports then depend on cjs-module-lexer); a static import inside a lazily imported module
  // becomes require(). `exports`: names the call sites use; the build probes them the same way.
  { pkg: 'markitdown-js', file: 'markitdown-js.cjs', load: 'import', exports: ['MarkItDown'] }, // pdf-parse + xlsx (~13 MB)
  { pkg: '@larksuiteoapi/node-sdk', file: 'lark-sdk.cjs', load: 'require', exports: ['Client', 'WSClient', 'EventDispatcher', 'Domain', 'LoggerLevel'] }, // ~5 MB
  { pkg: 'beautiful-mermaid', file: 'beautiful-mermaid.cjs', load: 'import', exports: ['renderMermaidSVG'] }, // elkjs (~3.5 MB)
] as const

export function mainVendorAliasFlags(): string[] {
  return MAIN_VENDOR_BUNDLES.flatMap(({ pkg, file }) => [`--alias:${pkg}=./vendor/${file}`, `--external:./vendor/${file}`])
}

/**
 * Node script that loads a vendor file the way main.cjs does and prints missing named exports as
 * JSON. The file URL, load style and export names arrive as argv (`node -e <script> <fileUrl>
 * <load> <name...>`), never as generated source, so no caller value is ever spliced into code.
 */
export const VENDOR_EXPORT_PROBE_SCRIPT = `const [fileUrl, load, ...names] = process.argv.slice(1)
const loaded = load === 'require'
  ? Promise.resolve().then(() => require(require('node:url').fileURLToPath(fileUrl)))
  : import(fileUrl)
loaded.then(m => { const missing = names.filter(n => typeof m[n] === 'undefined'); console.log(JSON.stringify(missing)); process.exit(missing.length ? 1 : 0) }, e => { console.error(e); process.exit(2) })`

/** Full `node` argv for the export probe: `-e` script first, then its data arguments. */
export function vendorExportProbe(fileUrl: string, names: readonly string[], load: 'import' | 'require' = 'import'): string[] {
  return ['-e', VENDOR_EXPORT_PROBE_SCRIPT, fileUrl, load, ...names]
}
