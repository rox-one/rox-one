import type { BinaryLike } from 'node:crypto'
import type { PathLike } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export interface RendererInventory {
  directory: string
  names: string[]
}

export interface BuiltRenderer {
  script: string
  spinnerLayout: string
  sources: Map<string, string>
  absentControls: string[]
  virtualInputs: string[]
  inventories: RendererInventory[]
  esbuildVersion: string
}

export interface RendererArtifact extends BuiltRenderer {
  manifestDigest?: string
  outputDigest: string
  directory?: string
  buildKind: 'fresh' | 'reused'
}

export function digest(content: BinaryLike): string
export function fileDigest(path: PathLike | FileHandle): Promise<string>
export function createFreshRendererDirectory(base?: string): Promise<string>
export function adoptVerifiedRendererArtifact(
  directory: string,
  verified: Pick<RendererArtifact, 'manifestDigest' | 'outputDigest'>,
): Promise<string>
export function bindRendererControls(sources: Map<string, string>, controls: readonly string[]): Promise<string[]>
export function loadOrBuildRendererArtifact(
  directory: string | undefined,
  expectedDigest: string | undefined,
  compile: () => Promise<BuiltRenderer>,
): Promise<RendererArtifact>
export function verifyRendererArtifact(artifact: RendererArtifact): Promise<void>
