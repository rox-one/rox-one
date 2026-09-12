/**
 * Optional Syft SBOM. Never auto-installs. Missing binary is a skipped scan.
 */

export interface SbomScan {
  available: boolean
  tool: 'syft'
  documents: readonly string[]
}

export type CommandRunner = (
  argv: readonly string[],
) => Promise<{ ok: boolean; stdout: string }>

export async function runSyftSbom(
  repoRoot: string,
  run: CommandRunner,
): Promise<SbomScan> {
  const result = await run(['syft', repoRoot, '-o', 'json'])
  if (!result.ok) {
    return { available: false, tool: 'syft', documents: [] }
  }
  return { available: true, tool: 'syft', documents: [result.stdout] }
}
