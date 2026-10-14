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
  { pkg: 'markitdown-js', file: 'markitdown-js.cjs' }, // pdf-parse + xlsx (~13 MB)
  { pkg: '@larksuiteoapi/node-sdk', file: 'lark-sdk.cjs' }, // ~5 MB
  { pkg: 'beautiful-mermaid', file: 'beautiful-mermaid.cjs' }, // elkjs (~3.5 MB)
] as const

export function mainVendorAliasFlags(): string[] {
  return MAIN_VENDOR_BUNDLES.flatMap(({ pkg, file }) => [`--alias:${pkg}=./vendor/${file}`, `--external:./vendor/${file}`])
}
