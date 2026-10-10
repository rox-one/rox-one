/**
 * W1-10 (#1507) — capture artifacts: the shape the wave-2 browser driver produces
 * and the `visual-snapshots` / `axe` / `one-rail-dom` gates consume.
 *
 * `scripts/visual-capture.ts` renders the screens with Playwright and writes the
 * artifacts under `VISUAL_ARTIFACTS_DIR` (gitignored); the gate runner reads them
 * from `<repoRoot>`. Without artifacts those three gates stay `pending` — the
 * documented wave-1 behaviour (`packages/test-harness/README.md`).
 *
 * Snapshots are compared by `pixelHash` rather than by decoding PNGs, so the
 * gates need no image library: the driver hashes the rendered RGBA bytes inside
 * the browser (canvas `getImageData`) and stores the same hash a baseline holds.
 * The hash is only comparable against a baseline produced by the same rendering
 * environment (fonts and antialiasing differ across machines); `environment`
 * records which one produced the baseline file.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { VisualSnapshotPlan } from './visual'

export const CAPTURE_SCHEMA_VERSION = 1
/** Artifact directory, relative to the repository root (gitignored). */
export const VISUAL_ARTIFACTS_DIR = '.visual-artifacts'
/** Artifact file name inside `VISUAL_ARTIFACTS_DIR`. */
export const CAPTURE_FILE = 'capture.json'
/** Committed baseline hashes, relative to the repository root. */
export const VISUAL_BASELINES_FILE = 'packages/test-harness/visual-baselines.json'

export interface CapturedScreen {
	/** Stable screen id from the driver's screen list. */
	id: string
	/**
	 * Rendered product-surface HTML: the Playground preview-frame subtree, the
	 * same element the snapshot screenshot captures, with the Playground chrome
	 * (header / sidebar / injected stylesheet) excluded. The axe gate audits
	 * this surface — not the whole harness document.
	 */
	html: string
	/**
	 * Rendered app-shell subtree carrying the navigation rail, or `''` when the
	 * surface mounts no app shell (see {@link CapturedScreen.hasAppShell}). The
	 * one-rail-dom gate reads this.
	 */
	shellHtml: string
	/**
	 * True when `shellHtml` carries a real app shell — a `role="navigation"`
	 * element with `data-rail`. The Playground's component-preview surfaces
	 * mount no app shell, so they record `false` with an empty `shellHtml`;
	 * the one-rail-dom gate then knows there is no rail to assert on.
	 */
	hasAppShell: boolean
}

export interface CapturedSnapshot {
	/** `snapshotKey(plan)` — the name shared by artifacts, baselines and reports. */
	key: string
	plan: VisualSnapshotPlan
	/** PNG path, relative to the artifact directory. */
	png: string
	/** SHA-256 of the snapshot's RGBA bytes, computed inside the rendering browser. */
	pixelHash: string
}

export interface CaptureArtifacts {
	schemaVersion: number
	capturedAt: string
	/** Screens the driver skipped or degraded, each with its reason; gates surface these. */
	notes: string[]
	screens: CapturedScreen[]
	snapshots: CapturedSnapshot[]
}

export interface VisualBaselines {
	schemaVersion: number
	/** Machine/profile that produced the hashes, e.g. `darwin-arm64 · chromium 1.64.0`. */
	environment: string
	hashes: Record<string, string>
}

/**
 * Deterministic name of one planned snapshot.
 *
 * Exported contract, not a convenience: the driver, the committed baselines file
 * and every gate report name a snapshot by this key, in lockstep.
 */
export function snapshotKey(plan: VisualSnapshotPlan): string {
	return [plan.screenId, plan.viewport.name, plan.profile, plan.theme, plan.locale, plan.state].join('__')
}

/**
 * App-shell navigation rails inside an HTML string: elements carrying both
 * `role="navigation"` and `data-rail`. One source of truth for the driver's
 * `hasAppShell` detection (`capture-screens.ts`) and the `one-rail-dom` gate's
 * count (`gates/chrome-dock.ts`), so the two cannot drift.
 */
export function railElements(html: string): string[] {
	return (
		html.match(
			/<[^>]*\brole=["']navigation["'][^>]*\bdata-rail\b[^>]*>|<[^>]*\bdata-rail\b[^>]*\brole=["']navigation["'][^>]*>/gi,
		) ?? []
	)
}

/** Artifacts of the last capture run, or `null` when absent, stale or malformed. */
export async function readArtifacts(repoRoot: string): Promise<CaptureArtifacts | null> {
	let parsed: unknown
	try {
		parsed = JSON.parse(await readFile(join(repoRoot, VISUAL_ARTIFACTS_DIR, CAPTURE_FILE), 'utf8'))
	} catch {
		return null
	}
	const artifacts = parsed as CaptureArtifacts | null
	if (!artifacts || artifacts.schemaVersion !== CAPTURE_SCHEMA_VERSION) return null
	if (!Array.isArray(artifacts.screens) || !Array.isArray(artifacts.snapshots) || !Array.isArray(artifacts.notes)) return null
	return artifacts
}

export async function writeArtifacts(repoRoot: string, artifacts: CaptureArtifacts): Promise<void> {
	const path = join(repoRoot, VISUAL_ARTIFACTS_DIR, CAPTURE_FILE)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(artifacts, null, '\t')}\n`)
}

/** Committed baseline hashes, or `null` when the file is absent or malformed. */
export async function readBaselines(repoRoot: string): Promise<VisualBaselines | null> {
	let parsed: unknown
	try {
		parsed = JSON.parse(await readFile(join(repoRoot, VISUAL_BASELINES_FILE), 'utf8'))
	} catch {
		return null
	}
	const baselines = parsed as VisualBaselines | null
	if (!baselines || baselines.schemaVersion !== CAPTURE_SCHEMA_VERSION || typeof baselines.hashes !== 'object' || baselines.hashes === null) return null
	return baselines
}

export async function writeBaselines(repoRoot: string, baselines: VisualBaselines): Promise<void> {
	const path = join(repoRoot, VISUAL_BASELINES_FILE)
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(baselines, null, '\t')}\n`)
}