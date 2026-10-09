/**
 * W1-10 (#1507) — Playwright visual-capture driver (the wave-2 browser driver).
 *
 * `captureScreens` reuses the rendering setup the existing suite already
 * proves works (`tests/visual/playground.spec.ts` + its `playwright.config.ts`),
 * generalised from a Playwright test into a reusable driver. For every entry of
 * `planVisualSnapshots(screenIds)` it pins the rendering environment — fixed
 * clock, viewport, UI profile (Rox / super-engineering), light/dark, RU/EN,
 * and the hover / focus-visible / motion-frame / reduced-motion states — writes
 * the PNG under `<VISUAL_ARTIFACTS_DIR>/shots/` and records the RGBA
 * `pixelHash` computed *inside* the browser (no PNG decoder in Node).
 *
 * Screens come from the real Playground surfaces the existing suite captures:
 * the story ids registered by `*.playground.tsx` (story ids and the accessible
 * heading are mirrored verbatim in `CAPTURE_SCREENS`).
 *
 * Artifacts feed `scripts/visual-capture.ts` (`bun run visual:capture`) and the
 * `visual-snapshots` / `axe` / `one-rail-dom` gates (see ../README.md).
 */

import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'

import { FIXED_CLOCK_MS, planVisualSnapshots, type VisualSnapshotPlan } from './visual.ts'
import {
	CAPTURE_SCHEMA_VERSION,
	VISUAL_ARTIFACTS_DIR,
	railElements,
	snapshotKey,
	type CaptureArtifacts,
	type CapturedScreen,
	type CapturedSnapshot,
} from './capture.ts'

/** Playground Vite port the existing suite pins (`tests/visual/playwright.config.ts`). */
export const PLAYGROUND_PORT = 5192
/** IPv4 loopback base URL of the Playground dev server. */
export const PLAYGROUND_BASE_URL = `http://127.0.0.1:${PLAYGROUND_PORT}`
/** Playground entry point, relative to the dev server root. */
export const PLAYGROUND_PATH = '/playground.html'

/**
 * Preview frame selector from the existing suite: the resizable container the
 * Playground wraps the story in (`ComponentPreview`). It is sized to the plan
 * viewport so an element screenshot is the production screen at exact
 * dimensions.
 */
export const PREVIEW_FRAME_SELECTOR =
	'#root > div > div > div.flex-1.flex.flex-col.overflow-hidden > div:last-child > div.relative'

/**
 * Shell subtrees that may carry the navigation rail, most specific first. The
 * real app shell exposes `data-rail-state` on its `ActivityRail`; a shell that
 * already carries the explicit rail (`role="navigation"` + `data-rail`) is
 * found directly; the Playground fallback is its navigation `<nav>` sidebar.
 * `shellHtml` is the first match that {@link railElements} confirms is a real
 * app shell — otherwise it is `''` and the screen records `hasAppShell: false`.
 */
export const SHELL_SELECTORS = ['[data-rail-state]', '[role="navigation"][data-rail]', '#root nav'] as const

/** `data-ui-profile` value each plan profile pins (Rox clears the attribute). */
const UI_PROFILE_ATTRIBUTE: Record<VisualSnapshotPlan['profile'], string | null> = {
	rox: null,
	se: 'super-engineering',
}

/** A screen the driver can render: a stable id plus the Playground story it maps to. */
export interface CaptureScreen {
	/** Stable screen id used in the snapshot plan, keys and gates. */
	id: string
	/** Playground story id for a given plan viewport width (mirrors the suite's preset mapping). */
	storyId: (viewportWidth: number) => string
	/** Accessible heading the story renders, used to await mount (mirrors the suite). */
	heading: (viewportWidth: number) => string
}

export function viewportPreset(width: number): 'desktop' | 'tablet' | 'mobile' {
	if (width >= 1000) return 'desktop'
	if (width >= 600) return 'tablet'
	return 'mobile'
}

function storyHeading(base: string, width: number): string {
	const preset = viewportPreset(width)
	return `${base} (${preset.charAt(0).toUpperCase()}${preset.slice(1)})`
}

/** Widths covering every Playground viewport preset, used to resolve a full story id. */
const RESOLVE_WIDTHS = [1440, 1280, 768, 390] as const

/**
 * Documented default screen list — the five production screens the existing
 * `tests/visual/playground.spec.ts` matrix captures. `id` is the stable base
 * id; `storyId` appends the Playground viewport preset the suite used.
 */
export const CAPTURE_SCREENS: readonly CaptureScreen[] = [
	{
		id: 'screen-entity-list-empty',
		storyId: () => 'screen-entity-list-empty',
		heading: () => 'Entity List Empty Screen',
	},
	{
		id: 'screen-chat-display',
		storyId: (width) => `screen-chat-display-${viewportPreset(width)}`,
		heading: (width) => storyHeading('Chat Display Screen', width),
	},
	{
		id: 'screen-settings-navigator',
		storyId: (width) => `screen-settings-navigator-${viewportPreset(width)}`,
		heading: (width) => storyHeading('Settings Navigator Screen', width),
	},
	{
		id: 'screen-browser-open-design',
		storyId: (width) => `screen-browser-open-design-${viewportPreset(width)}`,
		heading: (width) => storyHeading('Browser Open Design Screen', width),
	},
	{
		id: 'screen-planner-kanban',
		storyId: (width) => `screen-planner-kanban-${viewportPreset(width)}`,
		heading: (width) => storyHeading('Planner Kanban Screen', width),
	},
]

/** Ids of the default screen list, in registry order. */
export const DEFAULT_SCREEN_IDS: readonly string[] = CAPTURE_SCREENS.map((screen) => screen.id)

/**
 * Resolve a `--screens` value to a screen. Accepts the stable base id
 * (`screen-chat-display`) or a fully-qualified Playground story id
 * (`screen-chat-display-desktop`); the latter normalises to the base id so the
 * plan, snapshot keys and artifacts stay viewport-independent.
 */
export function resolveScreen(screenId: string): CaptureScreen | undefined {
	const exact = CAPTURE_SCREENS.find((screen) => screen.id === screenId)
	if (exact) return exact
	return CAPTURE_SCREENS.find((screen) =>
		RESOLVE_WIDTHS.some((width) => screen.storyId(width) === screenId),
	)
}

export interface CaptureScreensOptions {
	/** Repository root the artifacts are written under (`<repoRoot>/.visual-artifacts`). */
	repoRoot: string
	/** Screens to capture; defaults to `DEFAULT_SCREEN_IDS`. */
	screenIds?: readonly string[]
	/** Playground dev-server base URL; defaults to `PLAYGROUND_BASE_URL`. */
	baseURL?: string
	/** Progress sink (one line per screen). */
	log?: (line: string) => void
}

/**
 * Render every planned snapshot for the requested screens and return the
 * artifacts (the caller persists them; `scripts/visual-capture.ts` writes
 * `capture.json` and, with `--update-baselines`, the baselines file).
 *
 * A screen or a rendering combo that fails is recorded in `notes` and never
 * aborts the run: the remaining combos still produce snapshots.
 */
export async function captureScreens(options: CaptureScreensOptions): Promise<CaptureArtifacts> {
	const repoRoot = options.repoRoot
	const screenIds = options.screenIds && options.screenIds.length > 0 ? [...options.screenIds] : [...DEFAULT_SCREEN_IDS]
	const baseURL = options.baseURL ?? PLAYGROUND_BASE_URL
	const log = options.log ?? (() => {})
	const shotsDir = join(repoRoot, VISUAL_ARTIFACTS_DIR, 'shots')
	await mkdir(shotsDir, { recursive: true })

	const plan = planVisualSnapshots(screenIds)
	const notes: string[] = []
	const screens: CapturedScreen[] = []
	const snapshots: CapturedSnapshot[] = []

	const browser = await chromium.launch({ headless: true })
	try {
		try {
			await warmUp(browser, baseURL, log)
		} catch (error) {
			notes.push(`warmup: ${messageOf(error)}`)
		}
		for (const screenId of screenIds) {
			const screen = resolveScreen(screenId)
			if (!screen) {
				notes.push(`screen ${screenId}: unknown screen id — skipped`)
				log(`  ✗ ${screenId}: unknown screen id`)
				continue
			}
			const before = snapshots.length
			try {
				await captureScreen({
					browser,
					baseURL,
					screen,
					entries: plan.filter((entry) => entry.screenId === screen.id),
					shotsDir,
					screens,
					snapshots,
					notes,
				})
			} catch (error) {
				notes.push(`screen ${screen.id}: ${messageOf(error)}`)
			}
			log(`  ${snapshots.length > before ? '✓' : '✗'} ${screen.id}: ${snapshots.length - before} snapshot(s)`)
		}
	} finally {
		await browser.close()
	}

	return {
		schemaVersion: CAPTURE_SCHEMA_VERSION,
		capturedAt: new Date().toISOString(),
		notes,
		screens,
		snapshots,
	}
}

interface CaptureScreenRun {
	browser: Browser
	baseURL: string
	screen: CaptureScreen
	entries: VisualSnapshotPlan[]
	shotsDir: string
	screens: CapturedScreen[]
	snapshots: CapturedSnapshot[]
	notes: string[]
}

interface ScreenCombo {
	viewport: VisualSnapshotPlan['viewport']
	theme: VisualSnapshotPlan['theme']
	locale: VisualSnapshotPlan['locale']
	profiles: Array<{ profile: VisualSnapshotPlan['profile']; entries: VisualSnapshotPlan[] }>
}

/** Group a screen's plan by rendering context: the only things needing a fresh page. */
function groupCombos(entries: VisualSnapshotPlan[]): ScreenCombo[] {
	const combos: Record<string, ScreenCombo> = {}
	for (const entry of entries) {
		const key = [entry.viewport.name, entry.theme, entry.locale].join('|')
		const combo = (combos[key] ??= { viewport: entry.viewport, theme: entry.theme, locale: entry.locale, profiles: [] })
		let profile = combo.profiles.find((candidate) => candidate.profile === entry.profile)
		if (!profile) {
			profile = { profile: entry.profile, entries: [] }
			combo.profiles.push(profile)
		}
		profile.entries.push(entry)
	}
	return Object.values(combos)
}

/** Story mount budget. The first Vite compile is paid during `warmUp`, so this covers a slow render. */
const MOUNT_TIMEOUT_MS = 120_000
/** First-compile budget: Vite transforms the whole renderer graph on the first request. */
const WARMUP_TIMEOUT_MS = 600_000

/**
 * Pay Vite's first compile once before the timed combos: the Playground eagerly
 * globs every story, so waiting for its shell proves the story graph compiled.
 * Without this the first combos race a cold server and time out.
 */
async function warmUp(browser: Browser, baseURL: string, log: (line: string) => void): Promise<void> {
	log('  … warming the Playground (first Vite compile)…')
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
	try {
		const page = await context.newPage()
		await blockExternalResources(page)
		await page.goto(`${baseURL}${PLAYGROUND_PATH}`, { waitUntil: 'commit' })
		await page.locator('#root nav').waitFor({ state: 'visible', timeout: WARMUP_TIMEOUT_MS })
	} finally {
		await context.close()
	}
}

async function captureScreen(run: CaptureScreenRun): Promise<void> {
	let capturedScreen: CapturedScreen | undefined

	for (const combo of groupCombos(run.entries)) {
		const label = `${combo.viewport.name}/${combo.theme}/${combo.locale}`
		let context: BrowserContext | undefined
		try {
			context = await run.browser.newContext({
				viewport: { width: combo.viewport.width, height: combo.viewport.height },
				deviceScaleFactor: 1,
				colorScheme: combo.theme,
				locale: combo.locale === 'ru' ? 'ru-RU' : 'en-US',
				reducedMotion: 'no-preference',
			})
			const storyId = run.screen.storyId(combo.viewport.width)
			await context.addInitScript(configurePlayground, {
				storyId,
				viewport: { width: combo.viewport.width, height: combo.viewport.height },
				locale: combo.locale,
			})

			const page = await context.newPage()
			page.setDefaultNavigationTimeout(60_000)
			await blockExternalResources(page)
			await page.clock.setFixedTime(new Date(FIXED_CLOCK_MS))
			await page.goto(`${run.baseURL}${PLAYGROUND_PATH}`, { waitUntil: 'commit' })
			await page
				.getByRole('heading', { name: run.screen.heading(combo.viewport.width) })
				.waitFor({ state: 'visible', timeout: MOUNT_TIMEOUT_MS })
			await page.evaluate(injectStyles, DETERMINISM_CSS)
			await page.evaluate(waitForFonts)

			const frame = page.locator(PREVIEW_FRAME_SELECTOR)
			const frameCount = await frame.count()
			if (frameCount !== 1) throw new Error(`preview frame selector matched ${frameCount} element(s)`)
			await frame.evaluate(isolatePreview, { width: combo.viewport.width, height: combo.viewport.height })

			if (!capturedScreen) capturedScreen = await readScreen(page, frame, run.screen.id, run.notes)

			for (const { profile, entries } of combo.profiles) {
				await page.evaluate(applyUiProfile, UI_PROFILE_ATTRIBUTE[profile])
				for (const entry of entries) {
					await applyState(page, frame, entry)
					const buffer = await captureFrame(frame, entry, run.shotsDir)
					const pixelHash = await page.evaluate(hashPngInBrowser, buffer.toString('base64'))
					run.snapshots.push({
						key: snapshotKey(entry),
						plan: entry,
						png: `shots/${snapshotKey(entry)}.png`,
						pixelHash,
					})
					const dimensions = pngDimensions(buffer)
					if (dimensions.width !== entry.viewport.width || dimensions.height !== entry.viewport.height) {
						run.notes.push(
							`snapshot ${snapshotKey(entry)}: PNG is ${dimensions.width}×${dimensions.height}, expected ${entry.viewport.width}×${entry.viewport.height}`,
						)
					}
				}
			}
		} catch (error) {
			run.notes.push(`screen ${run.screen.id} [${label}]: ${messageOf(error)}`)
		} finally {
			await context?.close()
		}
	}

	if (capturedScreen) run.screens.push(capturedScreen)
	else run.notes.push(`screen ${run.screen.id}: no snapshots captured`)
}

/**
 * Read the product surface for a screen. `html` is the preview-frame subtree
 * (the surface the screenshot captures), so the axe audit judges the product
 * and not the Playground chrome. The shell is only kept when it really carries
 * an app shell — see `SHELL_SELECTORS`.
 */
async function readScreen(page: Page, frame: Locator, id: string, notes: string[]): Promise<CapturedScreen> {
	const html = await frame.evaluate(readPreviewFrameHtml)
	const extracted = await page.evaluate(readShellHtml, [...SHELL_SELECTORS])
	if (railElements(extracted).length === 0) {
		notes.push(
			`screen ${id}: no app shell in this surface (no role="navigation" + data-rail element) — component-preview surface, the one-rail-dom gate cannot assert here`,
		)
		return { id, html, shellHtml: '', hasAppShell: false }
	}
	return { id, html, shellHtml: extracted, hasAppShell: true }
}

/** The preview frame's outer HTML — the product surface, without the Playground chrome around it. */
function readPreviewFrameHtml(element: unknown): string {
	// Playwright hands us the located DOM node; `outerHTML` is a well-known Element member.
	const frame = element as { outerHTML: string }
	return frame.outerHTML
}

/** Reproduce the suite's determinism CSS; animations are left alive for motion frames. */
const DETERMINISM_CSS = `
	*, *::before, *::after {
		caret-color: transparent !important;
		transition: none !important;
	}

	html, body, button, input, select, textarea {
		font-family: Arial, sans-serif !important;
	}
`

/** The suite aborts external fonts/favicons and local React DevTools for offline determinism. */
async function blockExternalResources(page: Page): Promise<void> {
	await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort())
	await page.route('https://www.google.com/s2/favicons**', (route) => route.abort())
	await page.route('http://localhost:8097/**', (route) => route.abort())
}

const MOTION_FRACTION: Record<string, number> = {
	'motion-start': 0,
	'motion-mid': 0.5,
	'motion-end': 1,
}

async function applyState(page: Page, frame: Locator, entry: VisualSnapshotPlan): Promise<void> {
	switch (entry.state) {
		case 'hover':
			await frame.hover()
			break
		case 'focus-visible':
			await page.mouse.move(0, 0)
			await page.keyboard.press('Tab')
			break
		case 'motion-start':
		case 'motion-mid':
		case 'motion-end':
			await page.emulateMedia({ reducedMotion: 'no-preference' })
			await page.evaluate(seekAnimations, MOTION_FRACTION[entry.state] ?? 0)
			break
		case 'reduced-motion':
			await page.emulateMedia({ reducedMotion: 'reduce' })
			break
		default:
			await page.mouse.move(0, 0)
			break
	}
}

async function captureFrame(frame: Locator, entry: VisualSnapshotPlan, shotsDir: string): Promise<Buffer> {
	const motion = entry.state.startsWith('motion-')
	return frame.screenshot({
		path: join(shotsDir, `${snapshotKey(entry)}.png`),
		// Motion frames are captured at the frame we seeked to; every other state
		// is frozen exactly like the existing suite freezes animations.
		animations: motion ? 'allow' : 'disabled',
		caret: 'hide',
		scale: 'css',
	})
}

/**
 * PNG width/height from the IHDR chunk. No decoder is needed: the signature is
 * 8 bytes, then length (4) + type (4) + width (4) + height (4), big-endian.
 */
export function pngDimensions(buffer: Buffer): { width: number; height: number } {
	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * Environment string for the committed baselines: hashes are only comparable
 * against a baseline produced by the same machine + browser.
 */
export async function captureEnvironment(repoRoot: string): Promise<string> {
	let version = 'unknown'
	try {
		const manifest = JSON.parse(
			await readFile(join(repoRoot, 'node_modules', 'playwright', 'package.json'), 'utf8'),
		) as { version?: string }
		if (manifest.version) version = manifest.version
	} catch {
		// Version is informational; a missing manifest must not fail the run.
	}
	return `${process.platform}-${process.arch} · chromium ${version}`
}

// ---------------------------------------------------------------------------
// Browser-side functions. Serialised into the page by Playwright; they may only
// reference their own arguments. `BrowserScope` is a type-only structural view
// of the browser globals — the harness tsconfig has no DOM lib, and TypeScript
// types are erased before the function reaches the browser.
// ---------------------------------------------------------------------------

interface BrowserScope {
	document: {
		documentElement: { dataset: Record<string, string | undefined> }
		querySelector(selector: string): {
			outerHTML: string
			style: { setProperty(name: string, value: string, priority?: string): void }
		} | null
		getAnimations(): Array<{
			pause(): void
			currentTime: number | null
			effect?: { getComputedTiming(): { duration?: unknown; delay?: unknown } } | null
		}>
		fonts: { ready: Promise<unknown> }
		head: { appendChild(node: unknown): void }
		createElement(tag: string): { textContent: string }
	}
	location: { protocol: string }
	localStorage: { clear(): void; setItem(key: string, value: string): void }
	crypto: { subtle: { digest(algorithm: string, data: Uint8ClampedArray): Promise<ArrayBuffer> } }
	atob(data: string): string
	createImageBitmap(source: Blob): Promise<{ width: number; height: number }>
	OffscreenCanvas: new (width: number, height: number) => {
		getContext(type: '2d'): {
			drawImage(image: unknown, dx: number, dy: number): void
			getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray }
		} | null
	}
}

interface PreviewFrameElement {
	parentElement: {
		style: { setProperty(name: string, value: string, priority?: string): void }
		previousElementSibling: { setAttribute(name: string, value: string): void } | null
	} | null
	style: { flexShrink: string; width: string; height: string }
}

/** Seed the Playground + i18n selectors exactly like the existing suite, plus RU/EN. */
function configurePlayground(input: { storyId: string; viewport: { width: number; height: number }; locale: string }): void {
	const scope = globalThis as unknown as BrowserScope
	if (scope.location.protocol !== 'http:' && scope.location.protocol !== 'https:') return
	scope.localStorage.clear()
	scope.localStorage.setItem('playground-selected-component', input.storyId)
	scope.localStorage.setItem('playground-variants-sidebar-open', 'false')
	scope.localStorage.setItem('playground-preview-size', JSON.stringify(input.viewport))
	scope.localStorage.setItem('i18nextLng', input.locale)
}

/** Hide the Playground chrome and size the preview frame to the plan viewport (suite isolation). */
function isolatePreview(element: unknown, viewport: { width: number; height: number }): void {
	const scope = globalThis as unknown as BrowserScope
	const frame = element as PreviewFrameElement
	scope.document.querySelector('#root > div > header')?.style.setProperty('display', 'none', 'important')
	scope.document.querySelector('#root > div > div > nav')?.style.setProperty('display', 'none', 'important')

	const previewArea = frame.parentElement
	previewArea?.previousElementSibling?.setAttribute('style', 'display: none !important')
	previewArea?.style.setProperty('padding', '0', 'important')
	previewArea?.style.setProperty('overflow', 'visible', 'important')
	frame.style.flexShrink = '0'
	frame.style.width = `${viewport.width}px`
	frame.style.height = `${viewport.height}px`
}

/** Append the determinism stylesheet without Playwright's style-tag load bookkeeping. */
function injectStyles(css: string): void {
	const scope = globalThis as unknown as BrowserScope
	const style = scope.document.createElement('style')
	style.textContent = css
	scope.document.head.appendChild(style)
}

function waitForFonts(): Promise<unknown> {
	const scope = globalThis as unknown as BrowserScope
	return scope.document.fonts.ready
}

/** Pin the UI profile attribute (`se` → super-engineering; `rox` clears it). */
function applyUiProfile(attribute: string | null): void {
	const scope = globalThis as unknown as BrowserScope
	const root = scope.document.documentElement
	if (attribute === null) delete root.dataset.uiProfile
	else root.dataset.uiProfile = attribute
}

/** Pause every running animation and seek it to `fraction` (0…1) of its duration. */
function seekAnimations(fraction: number): number {
	const scope = globalThis as unknown as BrowserScope
	let seeked = 0
	for (const animation of scope.document.getAnimations()) {
		try {
			const timing = animation.effect?.getComputedTiming()
			const duration = typeof timing?.duration === 'number' ? timing.duration : 0
			const delay = typeof timing?.delay === 'number' ? timing.delay : 0
			animation.pause()
			animation.currentTime = delay + duration * fraction
			seeked += 1
		} catch {
			// Non-seekable animation (e.g. scroll-driven): leave it untouched.
		}
	}
	return seeked
}

function readShellHtml(selectors: string[]): string {
	const scope = globalThis as unknown as BrowserScope
	for (const selector of selectors) {
		const element = scope.document.querySelector(selector)
		if (element) return element.outerHTML
	}
	return ''
}

/** SHA-256 (hex) of the PNG's RGBA bytes, decoded and hashed entirely in the browser. */
async function hashPngInBrowser(base64: string): Promise<string> {
	const scope = globalThis as unknown as BrowserScope
	const binary = scope.atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

	const bitmap = await scope.createImageBitmap(new Blob([bytes], { type: 'image/png' }))
	const canvas = new scope.OffscreenCanvas(bitmap.width, bitmap.height)
	const context = canvas.getContext('2d')
	if (!context) throw new Error('OffscreenCanvas 2d context unavailable')
	context.drawImage(bitmap, 0, 0)
	const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data

	const digest = await scope.crypto.subtle.digest('SHA-256', rgba)
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}