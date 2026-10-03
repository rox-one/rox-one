/** Renderer stub: dependency lock blobs stay in main/server. */
export { ACPX_NPM_PIN, OPENCLAW_NPM_PIN } from '../../../../../packages/shared/src/toolchain/npm-pins';
export function getNpmLock(_tool: string, _version: string): string | null { return null; }
