/**
 * W1-10 self-test: the frozen capture contract (`../src/capture.ts`) and the
 * browser driver's plan helpers (`../src/capture-screens.ts`). No browser is
 * launched here — the driver is exercised for real by `bun run visual:capture`.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	CAPTURE_FILE,
	CAPTURE_SCHEMA_VERSION,
	VISUAL_ARTIFACTS_DIR,
	VISUAL_BASELINES_FILE,
	readArtifacts,
	readBaselines,
	railElements,
	snapshotKey,
	writeArtifacts,
	writeBaselines,
	type CaptureArtifacts,
	type VisualBaselines,
} from '../src/capture.ts'
import {
	CAPTURE_SCREENS,
	DEFAULT_SCREEN_IDS,
	PREVIEW_FRAME_SELECTOR,
	pngDimensions,
	resolveScreen,
	viewportPreset,
} from '../src/capture-screens.ts'
import { planVisualSnapshots, SNAPSHOTS_PER_SCREEN, VISUAL_VIEWPORTS } from '../src/visual.ts'

function tmpRoot(): string {
	return mkdtempSync(join(tmpdir(), 'w1-10-capture-'))
}

const sampleArtifacts: CaptureArtifacts = {
	schemaVersion: CAPTURE_SCHEMA_VERSION,
	capturedAt: '2026-10-09T00:00:00.000Z',
	notes: [],
	screens: [
		{
			id: 'inbox',
			html: '<div data-testid="surface"><button>Save</button></div>',
			shellHtml: '<nav role="navigation" data-rail="true"></nav>',
			hasAppShell: true,
		},
	],
	snapshots: [
		{
			key: 'inbox__desktop__rox__light__ru__default',
			plan: planVisualSnapshots(['inbox'])[0]!,
			png: 'shots/inbox__desktop__rox__light__ru__default.png',
			pixelHash: 'a'.repeat(64),
		},
	],
}

describe('capture contract', () => {
	test('snapshotKey is the deterministic screen/viewport/profile/theme/locale/state name', () => {
		expect(snapshotKey(planVisualSnapshots(['inbox'])[0]!)).toBe('inbox__desktop__rox__light__ru__default')
	})

	test('railElements finds only elements carrying both role="navigation" and data-rail', () => {
		expect(railElements('<nav role="navigation" data-rail="true"></nav>')).toHaveLength(1)
		expect(railElements('<nav data-rail="true" role=\'navigation\'></nav>')).toHaveLength(1)
		expect(railElements('<nav data-rail-state="expanded"></nav>')).toHaveLength(0)
		expect(railElements('<nav role="navigation" aria-label="rail"></nav>')).toHaveLength(0)
		expect(railElements('')).toHaveLength(0)
	})

	test('readArtifacts returns null when the file is absent or the root is empty', async () => {
		expect(await readArtifacts(tmpRoot())).toBeNull()
	})

	test('writeArtifacts writes under VISUAL_ARTIFACTS_DIR and round-trips', async () => {
		const root = tmpRoot()
		await writeArtifacts(root, sampleArtifacts)
		const onDisk = JSON.parse(await readFile(join(root, VISUAL_ARTIFACTS_DIR, CAPTURE_FILE), 'utf8'))
		expect(onDisk.schemaVersion).toBe(CAPTURE_SCHEMA_VERSION)
		expect(await readArtifacts(root)).toEqual(sampleArtifacts)
	})

	test('readArtifacts rejects malformed JSON, wrong schema version and the wrong shape', async () => {
		const root = tmpRoot()
		const path = join(root, VISUAL_ARTIFACTS_DIR, CAPTURE_FILE)
		await writeArtifacts(root, sampleArtifacts)
		await writeFile(path, '{ not json')
		expect(await readArtifacts(root)).toBeNull()
		await writeFile(path, JSON.stringify({ ...sampleArtifacts, schemaVersion: CAPTURE_SCHEMA_VERSION + 1 }))
		expect(await readArtifacts(root)).toBeNull()
		await writeFile(path, JSON.stringify({ ...sampleArtifacts, screens: 'nope' }))
		expect(await readArtifacts(root)).toBeNull()
	})

	test('baselines are absent-safe and round-trip with their environment', async () => {
		const root = tmpRoot()
		expect(await readBaselines(root)).toBeNull()
		const baselines: VisualBaselines = {
			schemaVersion: CAPTURE_SCHEMA_VERSION,
			environment: 'darwin-arm64 · chromium 1.64.0',
			hashes: { inbox__desktop__rox__light__ru__default: 'b'.repeat(64) },
		}
		await writeBaselines(root, baselines)
		expect(await readBaselines(root)).toEqual(baselines)
		await writeFile(join(root, VISUAL_BASELINES_FILE), JSON.stringify({ ...baselines, schemaVersion: 99 }))
		expect(await readBaselines(root)).toBeNull()
	})
})

describe('driver screen registry', () => {
	test('the default list is the five real Playground surfaces the suite captures', () => {
		expect([...DEFAULT_SCREEN_IDS]).toEqual([
			'screen-entity-list-empty',
			'screen-chat-display',
			'screen-settings-navigator',
			'screen-browser-open-design',
			'screen-planner-kanban',
		])
	})

	test('viewportPreset matches the suite boundaries', () => {
		expect(viewportPreset(1440)).toBe('desktop')
		expect(viewportPreset(1000)).toBe('desktop')
		expect(viewportPreset(768)).toBe('tablet')
		expect(viewportPreset(600)).toBe('tablet')
		expect(viewportPreset(599)).toBe('mobile')
		expect(viewportPreset(390)).toBe('mobile')
	})

	test('every plan viewport resolves to the desktop story the suite registers', () => {
		for (const screen of CAPTURE_SCREENS) {
			for (const viewport of VISUAL_VIEWPORTS) {
				const storyId = screen.storyId(viewport.width)
				expect(storyId.startsWith(screen.id)).toBe(true)
				if (screen.id === 'screen-entity-list-empty') expect(screen.heading(viewport.width)).toBe('Entity List Empty Screen')
				else expect(screen.heading(viewport.width)).toContain('(Desktop)')
			}
		}
	})

	test('the empty-state story keeps its suffix-free id and heading', () => {
		const screen = resolveScreen('screen-entity-list-empty')!
		expect(screen.storyId(1440)).toBe('screen-entity-list-empty')
		expect(screen.heading(1440)).toBe('Entity List Empty Screen')
	})

	test('resolveScreen accepts a base id or a fully-qualified story id, normalising to the base', () => {
		expect(resolveScreen('screen-chat-display')!.id).toBe('screen-chat-display')
		expect(resolveScreen('screen-chat-display-desktop')!.id).toBe('screen-chat-display')
		expect(resolveScreen('screen-settings-navigator-tablet')!.id).toBe('screen-settings-navigator')
		expect(resolveScreen('screen-planner-kanban-mobile')!.id).toBe('screen-planner-kanban')
		expect(resolveScreen('no-such-screen')).toBeUndefined()
	})

	test('the plan expands to the full matrix per screen with unique keys', () => {
		const plan = planVisualSnapshots([...DEFAULT_SCREEN_IDS])
		expect(SNAPSHOTS_PER_SCREEN).toBe(112)
		expect(plan.length).toBe(DEFAULT_SCREEN_IDS.length * SNAPSHOTS_PER_SCREEN)
		expect(new Set(plan.map((entry) => snapshotKey(entry))).size).toBe(plan.length)
		for (const id of DEFAULT_SCREEN_IDS) {
			expect(plan.filter((entry) => entry.screenId === id)).toHaveLength(SNAPSHOTS_PER_SCREEN)
		}
	})

	test('the preview frame selector is the suite selector (constant, shared with the gates)', () => {
		expect(PREVIEW_FRAME_SELECTOR).toContain('div.relative')
	})
})

describe('pngDimensions', () => {
	test('reads width and height from the IHDR chunk without a decoder', () => {
		const buffer = Buffer.alloc(24)
		buffer.writeUInt32BE(1440, 16)
		buffer.writeUInt32BE(900, 20)
		expect(pngDimensions(buffer)).toEqual({ width: 1440, height: 900 })
	})
})