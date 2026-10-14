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

/** Node script that loads a vendor file the way main.cjs does and prints missing named exports as JSON. */
export function vendorExportProbe(fileUrl: string, names: readonly string[], load: 'import' | 'require' = 'import'): string {
  const loader = load === 'require'
    ? `Promise.resolve().then(() => require(require('node:url').fileURLToPath(${JSON.stringify(fileUrl)})))`
    : `import(${JSON.stringify(fileUrl)})`
  return `${loader}.then(m => { const missing = ${JSON.stringify(names)}.filter(n => typeof m[n] === 'undefined'); console.log(JSON.stringify(missing)); process.exit(missing.length ? 1 : 0) }, e => { console.error(e); process.exit(2) })`
}
