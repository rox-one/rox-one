/** Renderer stub for `glob`. File discovery runs in main. */
export function globSync(_pattern?: unknown, _opts?: unknown): string[] {
  return []
}
export async function glob(_pattern?: unknown, _opts?: unknown): Promise<string[]> {
  return []
}
export default { globSync, glob }
