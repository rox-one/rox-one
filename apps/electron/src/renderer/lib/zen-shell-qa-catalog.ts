/**
 * ZS-08 requirement → case catalog. Evidence JSON records one result per case.
 * Native macOS/Windows effects are blocked on this Linux host — never "passed".
 */

export const ZEN_SHELL_REQUIREMENT_IDS = [
  'ZS-R01', 'ZS-R02', 'ZS-R03', 'ZS-R04', 'ZS-R05', 'ZS-R06', 'ZS-R07', 'ZS-R08',
  'ZS-R09', 'ZS-R10', 'ZS-R11', 'ZS-R12', 'ZS-R13', 'ZS-R14', 'ZS-R15', 'ZS-R16',
  'ZS-R17', 'ZS-R18', 'ZS-R19', 'ZS-R20', 'ZS-R21', 'ZS-R22', 'ZS-R23', 'ZS-R24',
  'ZS-R25', 'ZS-R26', 'ZS-R27', 'ZS-R28',
] as const

export type ZenShellRequirementId = typeof ZEN_SHELL_REQUIREMENT_IDS[number]
export type ZenShellQaResult = 'passed' | 'failed' | 'blocked' | 'not_run'

export interface ZenShellQaCaseDef {
  requirementId: ZenShellRequirementId
  caseId: string
  environment: string
  group: string
  description: string
}

export const ZEN_SHELL_QA_ENVIRONMENT = 'linux-cloud-agent'

export const ZEN_SHELL_QA_CASES: readonly ZenShellQaCaseDef[] = [
  { requirementId: 'ZS-R01', caseId: 'macos-outer-shadow', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'macos-window', description: 'Native outer corners and OS shadow on a real macOS window' },
  { requirementId: 'ZS-R02', caseId: 'macos-native-controls', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'macos-window', description: 'Native traffic lights active/inactive/fullscreen without HTML replacements' },
  { requirementId: 'ZS-R02', caseId: 'topbar-no-html-lights', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'macos-window', description: 'Source: TopBar does not paint HTML traffic lights' },
  { requirementId: 'ZS-R03', caseId: 'material-resolver-matrix', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'Resolver: system/glass/opaque × platform × a11y × paint/gpu' },
  { requirementId: 'ZS-R03', caseId: 'windows-mica-build', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'Windows mica only at build ≥22000; older Zen-ON is solid' },
  { requirementId: 'ZS-R04', caseId: 'first-paint-policy', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'macos-window', description: 'Show once; material after healthy paint; 4000ms timeout; GPU crash clears' },
  { requirementId: 'ZS-R05', caseId: 'a11y-beats-glass', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'Reduce Transparency and High Contrast force solid' },
  { requirementId: 'ZS-R06', caseId: 'chrome-glass-content-opaque', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'data-shell-role chrome vs opaque content token' },
  { requirementId: 'ZS-R07', caseId: 'geometry-tokens', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'Gap 8, inset 4, radius 8/14, sash 2/12/24, sidebar 180–360, navigator 240–480, content min 440' },
  { requirementId: 'ZS-R08', caseId: 'state-tokens', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'Hover/focus/selected/disabled tokens exist under data-shell-style=zen' },
  { requirementId: 'ZS-R09', caseId: 'topbar-safe-area', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'Safe-area and drag/no-drag at zoom 100/125/150 and fullscreen' },
  { requirementId: 'ZS-R10', caseId: 'topbar-history-menu', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'Existing history callbacks and app menu remain wired' },
  { requirementId: 'ZS-R11', caseId: 'disclosure-no-text-shift', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'Sibling disclosure; group header is one button; no nested buttons' },
  { requirementId: 'ZS-R12', caseId: 'disclosure-aria-keyboard', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'input', description: 'aria-expanded/controls, i18n expand/collapse, focus restore' },
  { requirementId: 'ZS-R13', caseId: 'splitter-hint', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'input', description: 'Shared sash primitive with i18n resize labels' },
  { requirementId: 'ZS-R14', caseId: 'splitter-commit-cancel', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'input', description: 'Pointer capture, cancel restores snapshot, 100 resize/cancel cycles' },
  { requirementId: 'ZS-R15', caseId: 'splitter-keyboard', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'input', description: 'Keyboard separator; Escape does not hit Double-Esc interrupt' },
  { requirementId: 'ZS-R16', caseId: 'splitter-minmax', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'размер', description: 'solveSplit min/max/infeasible; Infinity max allowed' },
  { requirementId: 'ZS-R17', caseId: 'commit-only-persistence', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'состояние', description: '0 durable writes on pointermove; commit-only adapter' },
  { requirementId: 'ZS-R18', caseId: 'layout-migration', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'состояние', description: 'Schema v1 validates finite numbers; legacy keys dual-written, never deleted' },
  { requirementId: 'ZS-R19', caseId: 'window-isolation', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'состояние', description: 'Live layout is per-window; no second layout store' },
  { requirementId: 'ZS-R20', caseId: 'native-suppression-unit', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'Visibility = mounted && focused && !removed && validBounds && !suppressed' },
  { requirementId: 'ZS-R20', caseId: 'native-webcontents-occlusion', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'Real WebContentsView occlusion vs overlay/resize on macOS' },
  { requirementId: 'ZS-R21', caseId: 'native-bounds-contract', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'Stale rAF apply:false; current gen + hidden sends rect null' },
  { requirementId: 'ZS-R21', caseId: 'native-zoom-fullscreen-os', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'CSS→native bounds after move/zoom/fullscreen on a real display' },
  { requirementId: 'ZS-R22', caseId: 'browserpanel-no-vps-viewport', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'BrowserPanelPage is the native host; WebBrowserPanel stays 390×720' },
  { requirementId: 'ZS-R22', caseId: 'native-no-reload-os', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'native-content', description: 'Resize/cancel keeps browser input/scroll without remount on real OS' },
  { requirementId: 'ZS-R23', caseId: 'classic-shell-default', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'featureUnifiedShellAtom and workbench atoms remain default OFF' },
  { requirementId: 'ZS-R23', caseId: 'linux-web-honest-solid', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'другие-платформы', description: 'Linux/web Zen-ON resolves solid; native vibrancy APIs are not called' },
  { requirementId: 'ZS-R23', caseId: 'qa-fixture-scale', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'shell', description: 'Fixture ≥500 sidebar rows, nested sections, 2 panels, draft + click/scroll counters' },
  { requirementId: 'ZS-R24', caseId: 'solve-split-budget', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'perf', description: '1000 solveSplit calls complete well under 50ms on this host' },
  { requirementId: 'ZS-R24', caseId: 'pointer-layout-p95', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'perf', description: 'pointer→layout p95 ≤32ms at 60Hz on recorded reference hardware' },
  { requirementId: 'ZS-R25', caseId: 'reduced-motion-css', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'material', description: 'Zen disclosure transition is none under prefers-reduced-motion' },
  { requirementId: 'ZS-R26', caseId: 'i18n-parity', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'i18n', description: 'Zen settings and QA labels present in all locales; parity lint' },
  { requirementId: 'ZS-R26', caseId: 'contrast-measurement', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'i18n', description: 'WCAG 4.5:1 / 3:1 contrast measured on a painted desktop window' },
  { requirementId: 'ZS-R27', caseId: 'flag-default-off', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'rollout', description: 'shell.zen.v1 default OFF; missing/invalid is OFF; no remote force-on' },
  { requirementId: 'ZS-R27', caseId: 'off-delegates-legacy', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'rollout', description: 'OFF does not attach Zen material policy; legacy window path stays in charge' },
  { requirementId: 'ZS-R27', caseId: 'set-zen-shell-patch', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'rollout', description: 'SET_ZEN_SHELL accepts only {enabled?, materialPreference?}' },
  { requirementId: 'ZS-R28', caseId: 'evidence-complete', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'rollout', description: 'All 28 requirements mapped; native gaps blocked not passed' },
  { requirementId: 'ZS-R28', caseId: 'repo-qa-commands', environment: ZEN_SHELL_QA_ENVIRONMENT, group: 'rollout', description: 'Recorded typecheck/lint/i18n/perf/build commands' },
]

export const ZEN_SHELL_QA_RESULTS: Record<string, ZenShellQaResult> = {
  'macos-outer-shadow': 'blocked',
  'macos-native-controls': 'blocked',
  'topbar-no-html-lights': 'passed',
  'material-resolver-matrix': 'passed',
  'windows-mica-build': 'passed',
  'first-paint-policy': 'passed',
  'a11y-beats-glass': 'passed',
  'chrome-glass-content-opaque': 'passed',
  'geometry-tokens': 'passed',
  'state-tokens': 'passed',
  'topbar-safe-area': 'passed',
  'topbar-history-menu': 'passed',
  'disclosure-no-text-shift': 'passed',
  'disclosure-aria-keyboard': 'passed',
  'splitter-hint': 'passed',
  'splitter-commit-cancel': 'passed',
  'splitter-keyboard': 'passed',
  'splitter-minmax': 'passed',
  'commit-only-persistence': 'passed',
  'layout-migration': 'passed',
  'window-isolation': 'passed',
  'native-suppression-unit': 'passed',
  'native-webcontents-occlusion': 'blocked',
  'native-bounds-contract': 'passed',
  'native-zoom-fullscreen-os': 'blocked',
  'browserpanel-no-vps-viewport': 'passed',
  'native-no-reload-os': 'blocked',
  'classic-shell-default': 'passed',
  'linux-web-honest-solid': 'passed',
  'qa-fixture-scale': 'passed',
  'solve-split-budget': 'passed',
  'pointer-layout-p95': 'not_run',
  'reduced-motion-css': 'passed',
  'i18n-parity': 'passed',
  'contrast-measurement': 'not_run',
  'flag-default-off': 'passed',
  'off-delegates-legacy': 'passed',
  'set-zen-shell-patch': 'passed',
  'evidence-complete': 'passed',
  'repo-qa-commands': 'not_run',
}

export function evidencePathFor(caseId: string): string {
  if (caseId === 'qa-fixture-scale') return 'apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx'
  if (caseId === 'repo-qa-commands') return 'docs/qa/zen-shell-evidence.json'
  if (caseId.startsWith('native-') && ZEN_SHELL_QA_RESULTS[caseId] === 'blocked') {
    return 'docs/qa/zen-shell-acceptance.md'
  }
  return 'docs/qa/zen-shell-acceptance.md'
}
