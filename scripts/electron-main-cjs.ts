/** Keep module-URL consumers valid when Electron main is bundled as CommonJS. */
export const ELECTRON_MAIN_CJS_FLAGS = [
  '--define:import.meta.url=__roxElectronMainBundleFileUrl',
  '--banner:js=var __roxElectronMainBundleFileUrl = require("node:url").pathToFileURL(__filename).href;',
] as const
