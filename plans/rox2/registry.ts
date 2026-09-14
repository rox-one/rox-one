import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROX2_CONATION_GAPS, ROX2_SCREENS, ROX2_SERVICES } from './inventory.ts'
import type { Rox2Card, Rox2Domain, Rox2Evidence } from './schema.ts'

type Draft = {
  title: string
  wave: number
  domain: Rox2Domain
  asIs: string
  toBe: string
  files: string[]
  contracts?: string[]
  plan?: string[]
  tests: string
  acceptance: string[]
  dependencies?: string[]
  rollback: string
  evidence: Rox2Evidence
}

const CONTRACT = 'packages/core/src/rox2/platform-contract.ts'
const SETTINGS_REGISTRY = 'apps/electron/src/shared/settings-registry.ts'

const SETTINGS_IDS = [
  'account',
  'privacy',
  'runtime',
  'context',
  'marketplace',
  'knowledge',
  'extensions',
  'import',
  'app',
  'ai',
  'appearance',
  'input',
  'workspace',
  'accounts',
  'permissions',
  'security',
  'labels',
  'organizations',
  'messaging',
  'server',
  'cloudRuns',
  'shortcuts',
] as const

const RPC_DIR = join(import.meta.dir, '../../packages/server-core/src/handlers/rpc')

function rpcHandlerFiles(): string[] {
  return readdirSync(RPC_DIR)
    .filter((name) => name.endsWith('.ts') && !name.includes('.test.') && name !== 'index.ts')
    .sort()
    .map((name) => `packages/server-core/src/handlers/rpc/${name}`)
}

function card(index: number, draft: Draft): Rox2Card {
  const id = `ROX2-${String(index).padStart(3, '0')}`
  return {
    id,
    title: draft.title,
    wave: draft.wave,
    domain: draft.domain,
    asIs: draft.asIs,
    toBe: draft.toBe,
    files: draft.files,
    contracts: draft.contracts ?? [CONTRACT],
    plan: draft.plan ?? [
      'Read AS-IS files and name the live vs documented evidence.',
      'Implement only this card. Do not mark queued/fixture work as live.',
      'Add or extend tests listed on the card before merging.',
    ],
    tests: draft.tests,
    acceptance: draft.acceptance,
    dependencies: draft.dependencies ?? ['ROX2-001'],
    rollback: draft.rollback,
    evidence: draft.evidence,
    status: 'open',
  }
}

function programDrafts(): Draft[] {
  return [
    {
      title: 'Program charter: evidence classes and live-vs-queued rule',
      wave: 0,
      domain: 'audit',
      asIs: 'Issue #315 opens the program against main 01712a37 / current ship after #313. No Rox2 registry existed.',
      toBe: 'Every audit claim is one of reproduced / statically-confirmed / documented / needs-verification / new-requirement. Fixture, simulation, and queued never present as completed/live.',
      files: ['plans/rox2/README.md', 'plans/rox2/schema.ts', CONTRACT],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: [
        'Registry exists with 200 unique cards',
        'Contract rejects queued/fixture as live',
      ],
      rollback: 'Delete plans/rox2 and packages/core/src/rox2.',
      evidence: 'new-requirement',
      dependencies: [],
    },
    {
      title: 'Screen inventory with file evidence',
      wave: 0,
      domain: 'audit',
      asIs: 'Nav destinations, settings pages, Notes, browser, playground, webui, viewer, and Conation panes are scattered across renderer files.',
      toBe: 'plans/rox2/inventory.ts lists each screen, files, evidence class, and coverage boundary.',
      files: ['plans/rox2/inventory.ts', 'apps/electron/src/renderer/components/app-shell/nav-destinations.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Every screen record points at an existing file'],
      rollback: 'Revert inventory.ts.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Service inventory with file evidence',
      wave: 0,
      domain: 'audit',
      asIs: 'RPC, Soup, DSS, knowledge, calendar, tasks, identity, transport, and OMP live in separate packages.',
      toBe: 'Service inventory names owners for transport/types/registry so waves do not race those files.',
      files: ['plans/rox2/inventory.ts', 'packages/server-core/src/handlers/rpc/index.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Every service record points at an existing file'],
      rollback: 'Revert inventory.ts.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Unified entity contract',
      wave: 0,
      domain: 'contract',
      asIs: 'SoupEntity, KnowledgeRef, calendar types, and task types are separate models.',
      toBe: 'Rox2EntityKind + format/parse ids in packages/core/src/rox2. Native stores keep their schemas; adapters map in and out.',
      files: [CONTRACT, 'packages/core/src/conation/soup/types.ts', 'packages/core/src/knowledge/refs.ts'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['All Soup concrete types map to a Rox2 kind'],
      rollback: 'Remove rox2 export from @craft-agent/core.',
      evidence: 'new-requirement',
    },
    {
      title: 'Unified event contract',
      wave: 0,
      domain: 'contract',
      asIs: 'Events are per-subsystem (session turns, memory writes, automations).',
      toBe: 'Rox2Event is the common envelope (id, entityId, type, at, actor). Subsystems may wrap, not replace, their logs.',
      files: [CONTRACT],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['Rox2Event type is exported from @craft-agent/core/rox2'],
      rollback: 'Remove Rox2Event.',
      evidence: 'new-requirement',
    },
    {
      title: 'Unified result contract with live gate',
      wave: 0,
      domain: 'contract',
      asIs: 'RPC handlers return ad-hoc objects. Playground fixtures look like product UI.',
      toBe: 'Rox2Result.ok+live is the only completed claim. queued/simulated/fixture helpers stay explicit.',
      files: [CONTRACT],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['isClaimableLive is false for queued, simulated, fixture'],
      rollback: 'Remove result helpers.',
      evidence: 'new-requirement',
    },
    {
      title: 'Unified context contract',
      wave: 0,
      domain: 'contract',
      asIs: 'NavigationContext, knowledge context, and work envelopes are separate.',
      toBe: 'Rox2Context carries workspaceId, optional session/surface, entityRefs, permissionMode.',
      files: [CONTRACT, 'apps/electron/src/renderer/contexts/NavigationContext.tsx'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['Rox2Context includes permissionMode allow-all|ask|safe'],
      rollback: 'Remove Rox2Context.',
      evidence: 'new-requirement',
    },
    {
      title: 'Permission and budget mapping',
      wave: 0,
      domain: 'permission',
      asIs: 'workspaceDefaults.permissionMode = allow-all. Feature flags hide Conation clients. Visibility ≠ background sync.',
      toBe: 'Native features stay available. device-read, cloud-send, share, publish, spend, destroy require explicit grant/budget.',
      files: [CONTRACT, 'packages/core/src/platform/identity/grants.ts'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['requiresExplicitGrant is true for sensitive permissions'],
      rollback: 'Keep previous permissionMode defaults.',
      evidence: 'documented',
    },
    {
      title: 'Relation model',
      wave: 0,
      domain: 'contract',
      asIs: 'Mindmap pins, knowledge refs, and session labels are unrelated graphs.',
      toBe: 'Rox2RelationKind covers parent/mentions/blocks/assigned/in-calendar/derived-from/attached-to.',
      files: [CONTRACT, 'packages/core/src/mindmap/types.ts'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['Relation kinds are a closed union'],
      rollback: 'Remove relation kinds.',
      evidence: 'new-requirement',
    },
    {
      title: 'Conation gap matrix',
      wave: 0,
      domain: 'conation',
      asIs: 'Soup types, DSS, Board/Fund deep links, and flag-off clients are documented in separate packages.',
      toBe: 'plans/rox2 inventory gap rows cover every Soup concrete type plus DSS/Board/Fund/flags.',
      files: ['plans/rox2/inventory.ts', 'packages/core/src/conation/soup/types.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Gap matrix includes every SoupEntityConcreteType'],
      rollback: 'Revert gap rows.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Wave plan and parallel-track rules',
      wave: 0,
      domain: 'wave',
      asIs: 'No ROX2 waves. next-program tickets are historical.',
      toBe: 'README waves 0–9. Parallel tracks start only after contracts freeze. One owner for transport/types/registry.',
      files: ['plans/rox2/README.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README lists waves and owner files'],
      rollback: 'Revert README.',
      evidence: 'new-requirement',
    },
    {
      title: 'Agent instructions for picking a card',
      wave: 0,
      domain: 'wave',
      asIs: 'Agents historically infer readiness from merged PR counts.',
      toBe: 'Pick the lowest open card whose dependencies are merged. Do not close #315 because later PRs exist.',
      files: ['plans/rox2/README.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README forbids inferring readiness from PR count'],
      rollback: 'Revert README.',
      evidence: 'new-requirement',
    },
    {
      title: 'Preserve LICENSE, NOTICE, and attribution',
      wave: 0,
      domain: 'identity',
      asIs: 'Upstream Apache LICENSE/NOTICE and Craft protocol IDs are still required.',
      toBe: 'No blind Craft→ROX rename of protocol, storage, or OAuth IDs. Attribution files stay.',
      files: ['LICENSE', 'NOTICE', 'docs/unfinished-initiatives.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['LICENSE and NOTICE still exist at repo root'],
      rollback: 'Do not delete legal files.',
      evidence: 'documented',
    },
    {
      title: 'Freeze OAuth, storage, and protocol IDs',
      wave: 0,
      domain: 'identity',
      asIs: '~/.craft-agent, CRAFT_*, craftagents://, com.lukilabs.craft-agent remain live identifiers.',
      toBe: 'ROX2 work never strands those IDs. Branding copy may change; IDs do not.',
      files: ['plans/identity-migration-plan.md', 'docs/unfinished-initiatives.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Identity freeze is listed as a program constraint'],
      rollback: 'No ID migration in this PR.',
      evidence: 'documented',
    },
    {
      title: 'Playground stays fixture',
      wave: 0,
      domain: 'screen',
      asIs: 'Playground registry renders product-looking stories from fixtures.',
      toBe: 'Playground stories cannot set Rox2Result.state=live. QA fixtures are labeled fixture.',
      files: ['apps/electron/src/renderer/playground/registry/types.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Inventory coverage for playground says fixture'],
      rollback: 'No playground code change required in wave 0.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Transport owner lock',
      wave: 0,
      domain: 'wave',
      asIs: 'apps/electron/src/transport is a shared seam.',
      toBe: 'Only one in-flight PR edits transport. Other waves depend, they do not fork the protocol.',
      files: ['apps/electron/src/transport/index.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README names transport as a single-owner file'],
      rollback: 'Revert README owner table.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Types owner lock',
      wave: 0,
      domain: 'wave',
      asIs: 'packages/core/src/rox2 is the new shared contract.',
      toBe: 'One owner for rox2 contract files. Domain adapters import, they do not copy kinds.',
      files: [CONTRACT],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['@craft-agent/core/rox2 export exists'],
      rollback: 'Remove the export.',
      evidence: 'new-requirement',
    },
    {
      title: 'Registry owner lock',
      wave: 0,
      domain: 'wave',
      asIs: 'No machine-readable ROX2 registry.',
      toBe: 'plans/rox2/registry.ts is the SoT. JSON emit is derived. No duplicate card IDs.',
      files: ['plans/rox2/registry.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Exactly 200 unique IDs ROX2-001..200'],
      rollback: 'Delete registry.',
      evidence: 'new-requirement',
    },
    {
      title: 'Evidence freshness stamp',
      wave: 0,
      domain: 'audit',
      asIs: 'Issue #315 asked for a refresh after d286440d; verification base named 01712a37.',
      toBe: 'README records ship SHA for this inventory (post #313). Later agents restamp rather than invent live claims.',
      files: ['plans/rox2/README.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README names the inventory base SHA'],
      rollback: 'Revert README stamp.',
      evidence: 'documented',
    },
    {
      title: 'Separate fixes from design cards',
      wave: 0,
      domain: 'wave',
      asIs: 'Historical PRs mixed chrome fixes with program docs.',
      toBe: 'Bugfix PRs do not close design cards. Design cards stay open until their acceptance is met with tests.',
      files: ['plans/rox2/README.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README says fixes are separate PRs'],
      rollback: 'Revert README.',
      evidence: 'new-requirement',
    },
  ]
}

function screenDrafts(): Draft[] {
  return ROX2_SCREENS.map((screen) => ({
    title: `Native surface: ${screen.title}`,
    wave: 1,
    domain: 'screen' as const,
    asIs: screen.coverage,
    toBe: `Keep ${screen.id} as a native Rox surface. Bind user actions to Rox2 entities/results. Do not replace it with a Conation iframe.`,
    files: [...screen.files],
    tests: 'plans/rox2/__tests__/program.test.ts',
    acceptance: [
      `${screen.id} remains reachable without Conation flags`,
      'No iframe/embed of conation.dev on this surface',
    ],
    rollback: `Leave ${screen.id} as-is.`,
    evidence: screen.evidence,
  }))
}

function settingsDrafts(): Draft[] {
  return SETTINGS_IDS.map((id) => ({
    title: `Settings page ${id}: native chrome and Rox2 actions`,
    wave: 1,
    domain: 'screen' as const,
    asIs: `SETTINGS_PAGES includes '${id}' in settings-registry.ts. Conation network clients are not this page's job.`,
    toBe: `Keep '${id}' native (PanelHeader/ScrollArea where already landed). Sensitive rows use requiresExplicitGrant. No Conation iframe.`,
    files: [SETTINGS_REGISTRY],
    tests: 'apps/electron/src/renderer/pages/settings/__tests__/settings-chrome-p35.test.ts',
    acceptance: [`'${id}' stays in SETTINGS_PAGES`, 'Page does not embed conation.dev'],
    rollback: `Do not remove '${id}'.`,
    evidence: 'statically-confirmed',
  }))
}

function conationDrafts(): Draft[] {
  const perGap: Draft[] = ROX2_CONATION_GAPS.map((gap) => ({
    title: `Conation gap: ${gap.id} (${gap.integration})`,
    wave: 2,
    domain: 'conation' as const,
    asIs: gap.asIs,
    toBe: gap.toBe,
    files: [...gap.files],
    tests: 'plans/rox2/__tests__/program.test.ts',
    acceptance: [
      `${gap.id} stays in the gap matrix until native actions exist`,
      'Deep links are not reported as live native UI',
    ],
    rollback: 'Keep current adapter; do not add writes.',
    evidence: gap.evidence,
  }))

  const verbs: Array<{ verb: string; toBe: string }> = [
    {
      verb: 'list',
      toBe: 'List returns Rox2Entity[] from the native store or a read adapter. Empty list is live; mocked rows are fixture.',
    },
    {
      verb: 'read',
      toBe: 'Read one entity by Rox2 id. Missing entity is an error result, not a fake record.',
    },
    {
      verb: 'act',
      toBe: 'Mutating actions go through permission + Rox2Result. No silent CompleteMutationRoot.',
    },
  ]

  const extra: Draft[] = []
  for (const gap of ROX2_CONATION_GAPS.slice(0, 8)) {
    for (const { verb, toBe } of verbs) {
      extra.push({
        title: `Conation ${gap.id} ${verb} action`,
        wave: 2,
        domain: 'conation',
        asIs: `${gap.asIs} Current integration=${gap.integration}.`,
        toBe,
        files: [...gap.files, CONTRACT],
        tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
        acceptance: [`${gap.id} ${verb} names live vs fixture in tests`],
        rollback: 'Leave adapter read-only.',
        evidence: gap.evidence,
      })
    }
  }

  return [...perGap, ...extra]
}

function notesDrafts(): Draft[] {
  return [
    {
      title: 'Native Notes vault without SiYuan runtime',
      wave: 3,
      domain: 'notes',
      asIs: 'KnowledgeProvider still has a SiYuan adapter. Native NotesPage also exists.',
      toBe: 'Default Notes/Knowledge path works with the native store. SiYuan remains an optional provider, not a runtime requirement.',
      files: [
        'apps/electron/src/renderer/pages/NotesPage.tsx',
        'packages/core/src/knowledge/providers/siyuan/adapter.ts',
        'packages/core/src/knowledge/providers/inmemory.ts',
      ],
      tests: 'packages/core/src/knowledge/__tests__/inmemory-provider.test.ts',
      acceptance: ['Notes open with SiYuan disabled', 'SiYuan adapter stays optional'],
      rollback: 'Keep SiYuan adapter; do not delete it.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'knowledge_propose stays proposal-only until apply exists',
      wave: 3,
      domain: 'notes',
      asIs: 'knowledge_propose lands pending proposals. Approve/apply are human-only.',
      toBe: 'Do not report propose as apply. Apply is a later card with snapshot/rollback.',
      files: ['docs/unfinished-initiatives.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Propose ≠ apply in copy and tests'],
      rollback: 'Leave propose-only.',
      evidence: 'documented',
    },
    {
      title: 'Inbox/Daily/Tags empty sections get real data or stay hidden',
      wave: 3,
      domain: 'notes',
      asIs: 'features.inbox|daily|tags are false for SiYuan; navigator uses unsupported vs hidden.',
      toBe: 'Native provider either implements the section or hides it. No fake rows.',
      files: ['packages/core/src/knowledge/capabilities.ts', 'docs/unfinished-initiatives.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Unsupported sections do not render fixture items'],
      rollback: 'Keep capability flags false.',
      evidence: 'documented',
    },
    {
      title: 'Note inspector is native, not Conation inspector',
      wave: 3,
      domain: 'notes',
      asIs: 'NoteInspector.tsx is native. Conation inspector host is empty and flag-off.',
      toBe: 'Keep one inspector. Conation contribution may show Soup metadata only when the flag is on.',
      files: [
        'apps/electron/src/renderer/pages/notes/NoteInspector.tsx',
        'apps/electron/src/renderer/platform/conation/ConationInspectorPanel.tsx',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Native inspector works with Conation flags off'],
      rollback: 'Do not merge inspectors.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Notes graph/wiki/table stay native views',
      wave: 3,
      domain: 'notes',
      asIs: 'NotesViewHost and note-views.ts host graph/wiki/table.',
      toBe: 'Views read native notes. Conation documents appear only via adapter ids.',
      files: [
        'apps/electron/src/renderer/pages/notes/NotesViewHost.tsx',
        'apps/electron/src/renderer/pages/notes/note-views.ts',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Notes views do not iframe Conation'],
      rollback: 'Keep current views.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Notes import stays native notes-import RPC',
      wave: 3,
      domain: 'notes',
      asIs: 'notes-import.ts handles imports separately from Conation Notes bridge.',
      toBe: 'Imports produce native note entities. Conation is not required.',
      files: ['packages/server-core/src/handlers/rpc/notes-import.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Import RPC does not call Soup writes'],
      rollback: 'Keep notes-import as-is.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Vault insights stay labeled derived',
      wave: 3,
      domain: 'notes',
      asIs: 'vault-insights.ts derives entities. That is derived data, not a live CRM.',
      toBe: 'Insights emit Rox2 entities with source=native and must not claim Conation CRM live sync.',
      files: ['packages/shared/src/knowledge/vault-insights.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Insights are not reported as CRM live'],
      rollback: 'Keep insights local.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Knowledge settings remain connection UI, not the vault',
      wave: 3,
      domain: 'notes',
      asIs: 'KnowledgeSettingsPage configures providers. It is not the Notes surface.',
      toBe: 'Settings stay chrome-consistent. Vault features live on Notes/Knowledge surfaces.',
      files: ['apps/electron/src/renderer/pages/settings/KnowledgeSettingsPage.tsx'],
      tests: 'apps/electron/src/renderer/pages/settings/__tests__/settings-chrome-p35.test.ts',
      acceptance: ['Knowledge settings use PanelHeader', 'No second vault UI inside settings'],
      rollback: 'Keep settings page.',
      evidence: 'statically-confirmed',
    },
  ]
}

function calendarDrafts(): Draft[] {
  return [
    {
      title: 'Single native calendar, Soup events as adapter',
      wave: 4,
      domain: 'calendar',
      asIs: 'packages/core/src/calendar exists. GraphqlSoupCalendarEvent is type-only.',
      toBe: 'One calendar UI. Soup events map to calendar-event entities when the read client is on.',
      files: ['packages/core/src/calendar/index.ts', CONTRACT],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['No second calendar pane', 'Adapter is flag-gated'],
      rollback: 'Keep packages separate.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Projects stay native ProjectInfo + projects RPC',
      wave: 4,
      domain: 'calendar',
      asIs: 'ProjectInfoPage + projects.ts. Soup project type unused in UI.',
      toBe: 'Project actions stay on projects RPC. Optional Soup list is an adapter.',
      files: ['apps/electron/src/renderer/pages/ProjectInfoPage.tsx', 'packages/server-core/src/handlers/rpc/projects.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Projects work with Conation off'],
      rollback: 'No Soup writes.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Pages/canvas stay native; Fund is not the product canvas',
      wave: 4,
      domain: 'calendar',
      asIs: 'pages RPC + mindmap engine. Fund pane is a deep link and perf-gated.',
      toBe: 'Interactive canvas work happens in pages/mindmap. Fund remains external or adapter.',
      files: ['packages/server-core/src/handlers/rpc/pages.ts', 'packages/core/src/mindmap/types.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Fund deep link is not claimed as native canvas'],
      rollback: 'Keep Fund as deep link.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Kanban stays native; Board deep link is not a second board',
      wave: 4,
      domain: 'calendar',
      asIs: 'KanbanBoard.tsx is native. Conation Board copy already forbids a second board.',
      toBe: 'Task entities may ingest Conation Board data later. UI stays KanbanBoard.',
      files: [
        'apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx',
        'apps/electron/src/renderer/pages/TasksPage.tsx',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Only one kanban UI'],
      rollback: 'Keep deep link pane behind flag.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Reminders are first-class entities, not toast-only',
      wave: 4,
      domain: 'calendar',
      asIs: 'GraphqlSoupReminder is type-only. No native reminder store on the calendar package export.',
      toBe: 'reminder kind exists on Rox2. Creating one is a live write with permission.',
      files: [CONTRACT, 'packages/core/src/calendar/index.ts'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['reminder is a Rox2EntityKind'],
      rollback: 'Keep kind; do not fake a store.',
      evidence: 'new-requirement',
    },
    {
      title: 'Mail thread native list',
      wave: 4,
      domain: 'conation',
      asIs: 'No Mail surface. Soup email thread is type-only.',
      toBe: 'Native entity-list of mail-thread with read adapter. Sending requires cloud-send.',
      files: [CONTRACT, 'apps/electron/src/renderer/components/ui/entity-list.tsx'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['mail-thread is a Rox2EntityKind', 'No iframe inbox'],
      rollback: 'Kind-only until UI ships.',
      evidence: 'new-requirement',
    },
    {
      title: 'CRM company native list',
      wave: 4,
      domain: 'conation',
      asIs: 'No CRM surface. Vault insights are not CRM.',
      toBe: 'crm-company entities in entity-list. Writes behind permission. Do not reuse vault-insights as CRM.',
      files: [CONTRACT, 'packages/shared/src/knowledge/vault-insights.ts'],
      tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
      acceptance: ['crm-company kind exists', 'Insights stay derived'],
      rollback: 'Kind-only until UI ships.',
      evidence: 'new-requirement',
    },
    {
      title: 'Drive files as file entities via DSS list/read',
      wave: 4,
      domain: 'conation',
      asIs: 'DSS client is read-only and flag-off. No Drive browser.',
      toBe: 'file entities from DSS list when flag on. Writes remain blocked.',
      files: ['packages/core/src/conation/dss/client.ts', CONTRACT],
      tests: 'packages/core/src/conation/dss/__tests__/dss-client.test.ts',
      acceptance: ['DSS writes stay omitted', 'List/read may be live when authenticated'],
      rollback: 'Keep client read-only.',
      evidence: 'documented',
    },
  ]
}

function contextDrafts(): Draft[] {
  return [
    {
      title: 'Right session stays contextual, not a second chat product',
      wave: 5,
      domain: 'context',
      asIs: 'ChatPage PanelHeader + inspector slots. Unified shell inspector is mostly stubs (info live).',
      toBe: 'Right session shows Rox2Context entityRefs for the focused surface. No duplicate transcript store.',
      files: [
        'apps/electron/src/renderer/pages/ChatPage.tsx',
        'docs/unfinished-initiatives.md',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Context panel reads focused entity refs', 'Inspector stubs are not claimed live'],
      rollback: 'Keep current inspector.',
      evidence: 'documented',
    },
    {
      title: 'Context keys evaluate when-language without Conation',
      wave: 5,
      domain: 'context',
      asIs: 'packages/core/src/platform/context-keys is native unified-shell.',
      toBe: 'Rox2Context.surfaceId maps onto existing context keys. Conation flags are extra keys, not replacements.',
      files: ['packages/core/src/platform/context-keys/service.ts', CONTRACT],
      tests: 'packages/core/src/platform/__tests__/context-keys.test.ts',
      acceptance: ['Context keys work with Conation flags off'],
      rollback: 'Do not replace context-keys.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Workbench flags remain opt-in for Conation, on for native',
      wave: 5,
      domain: 'context',
      asIs: 'workbench.conation.* default false. Unified shell also defaults off.',
      toBe: 'Native nav destinations stay on. Conation clients stay off until the user enables them.',
      files: [
        'packages/core/src/platform/workbench/flags.ts',
        'packages/core/src/conation/shell/flags.ts',
      ],
      tests: 'packages/core/src/conation/shell/__tests__/flags.test.ts',
      acceptance: ['Conation flags default false', 'Native nav remains enabled'],
      rollback: 'Keep flag defaults.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Session apply stub is not a live Conation write',
      wave: 5,
      domain: 'context',
      asIs: 'session-apply client is a stub behind a flag, linked to AgentTeamsStore.',
      toBe: 'Until a real apply exists, results are documented/queued, never live.',
      files: ['packages/core/src/platform/session-apply/client.ts'],
      tests: 'packages/core/src/platform/session-apply/client.test.ts',
      acceptance: ['Stub cannot return state=live'],
      rollback: 'Keep stub.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Omnibox Conation routes are not a product surface',
      wave: 5,
      domain: 'context',
      asIs: 'omnibox-conation.ts exists for slash routing tests.',
      toBe: 'Omnibox may deep-link; it must not spawn a hidden Conation iframe.',
      files: ['apps/electron/src/renderer/platform/omnibox-conation.ts'],
      tests: 'apps/electron/src/renderer/platform/__tests__/omnibox-conation.test.ts',
      acceptance: ['Omnibox tests do not claim live Soup writes'],
      rollback: 'Keep current routes.',
      evidence: 'statically-confirmed',
    },
  ]
}

function memoryDrafts(): Draft[] {
  return [
    {
      title: 'Memory proposals are candidates, not applied memory',
      wave: 6,
      domain: 'memory',
      asIs: 'memory-proposals.ts exists. UI/diff/apply is incomplete per unfinished-initiatives.',
      toBe: 'Auto-created candidates are Rox2 entities with status candidate. Apply is a separate permissioned action.',
      files: [
        'packages/server-core/src/handlers/rpc/memory-proposals.ts',
        'packages/server-core/src/handlers/rpc/memory.ts',
      ],
      tests: 'packages/server-core/src/handlers/rpc/memory-proposals.test.ts',
      acceptance: ['Proposal ≠ applied memory'],
      rollback: 'Keep proposals pending.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Knowledge candidates are proposals, not publications',
      wave: 6,
      domain: 'memory',
      asIs: 'knowledge publications.ts and mutations.ts exist. Write cycle is incomplete.',
      toBe: 'Auto candidates use MutationProposal. Publication is a later permissioned card.',
      files: [
        'packages/core/src/knowledge/publications.ts',
        'packages/core/src/knowledge/mutations.ts',
      ],
      tests: 'packages/core/src/knowledge/__tests__/publications.test.ts',
      acceptance: ['Candidates do not publish'],
      rollback: 'Keep mutations proposal-only.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Workflow candidates are automations drafts',
      wave: 6,
      domain: 'memory',
      asIs: 'automations.ts + graph editor. No auto-create of verifiable workflows.',
      toBe: 'Candidates are automation drafts with tests. Enabling one is spend/write permission.',
      files: [
        'packages/server-core/src/handlers/rpc/automations.ts',
        'apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx',
      ],
      tests: 'packages/server-core/src/handlers/rpc/automations-graph.test.ts',
      acceptance: ['Draft ≠ enabled automation'],
      rollback: 'Do not auto-enable.',
      evidence: 'documented',
    },
    {
      title: 'Memory insights stay insights, not live telemetry',
      wave: 6,
      domain: 'memory',
      asIs: 'memory-insights.ts exists with tests.',
      toBe: 'Insights results are documented/derived unless backed by live reads.',
      files: ['packages/server-core/src/handlers/rpc/memory-insights.ts'],
      tests: 'packages/server-core/src/handlers/rpc/memory-insights.test.ts',
      acceptance: ['Insights tests do not set live for fixture data'],
      rollback: 'Keep insights local.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Work envelope stays JSONL source of truth',
      wave: 6,
      domain: 'memory',
      asIs: 'knowledge/work-envelope.ts plus specs for JSONL + optional sqlite projection.',
      toBe: 'Candidates persist in the envelope. sqlite remains a projection, not SoT.',
      files: ['packages/core/src/knowledge/work-envelope.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['JSONL remains SoT in the card text'],
      rollback: 'Do not flip SoT to sqlite.',
      evidence: 'documented',
    },
  ]
}

function collabDrafts(): Draft[] {
  return [
    {
      title: 'Organizations settings is not multiplayer',
      wave: 7,
      domain: 'collab',
      asIs: 'OrganizationsSettingsPage + orgs RPC exist.',
      toBe: 'Real collab needs presence, sharing grants, and conflict policy. Org settings alone are not collab.',
      files: [
        'apps/electron/src/renderer/pages/settings/OrganizationsSettingsPage.tsx',
        'packages/server-core/src/handlers/rpc/orgs.ts',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Do not claim orgs settings as live collab'],
      rollback: 'Keep orgs as-is.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Viewer share is share-out, not collaborative editing',
      wave: 7,
      domain: 'collab',
      asIs: 'apps/viewer is a share viewer with residual hardening follow-ups.',
      toBe: 'Share links stay read-only unless a later card adds grants. Not a collab canvas.',
      files: ['apps/viewer/src/App.tsx'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Viewer remains read-only in this program until a grant card lands'],
      rollback: 'No viewer rewrite in wave 0.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Messaging settings is not Conation channels',
      wave: 7,
      domain: 'collab',
      asIs: 'MessagingSettingsPage is native. Soup channels unused.',
      toBe: 'Keep messaging settings. Channel entities are a separate card.',
      files: [
        'apps/electron/src/renderer/pages/settings/MessagingSettingsPage.tsx',
        'packages/server-core/src/handlers/rpc/messaging.ts',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Messaging settings does not iframe Conation'],
      rollback: 'Keep page.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Discord adapter is a separate surface, not Conation',
      wave: 7,
      domain: 'collab',
      asIs: 'docs/unfinished-initiatives.md lists Discord adapter as started, not live E2E.',
      toBe: 'Discord work stays on its own cards. Do not reuse Conation channel types as Discord.',
      files: ['docs/unfinished-initiatives.md', 'docs/superpowers/plans/2026-07-09-discord-adapter.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Discord is not marked live'],
      rollback: 'No Discord code in this PR.',
      evidence: 'documented',
    },
    {
      title: 'iOS client is a separate surface',
      wave: 7,
      domain: 'collab',
      asIs: 'iOS/iPadOS client is started, not MVP-complete.',
      toBe: 'ROX2 contracts should be importable later. This program does not ship iOS.',
      files: ['docs/superpowers/plans/2026-07-11-ios-native-client-plan.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['iOS is documented, not claimed complete'],
      rollback: 'No iOS code in this PR.',
      evidence: 'documented',
    },
  ]
}

function permissionDrafts(): Draft[] {
  const sensitive: Array<{ perm: string; example: string }> = [
    { perm: 'device-read', example: 'browser profile import, mic, filesystem' },
    { perm: 'cloud-send', example: 'mail send, Soup/DSS authenticated calls' },
    { perm: 'share', example: 'viewer share links' },
    { perm: 'publish', example: 'knowledge publication' },
    { perm: 'spend', example: 'cloud runs, paid models' },
    { perm: 'destroy', example: 'account deletion, vault wipe' },
  ]
  return sensitive.map(({ perm, example }) => ({
    title: `Explicit grant for ${perm}`,
    wave: 8,
    domain: 'permission' as const,
    asIs: `Feature visibility is not a grant. Example surface: ${example}.`,
    toBe: `requiresExplicitGrant('${perm}') is true. UI may show the control; the action still asks.`,
    files: [CONTRACT, 'apps/electron/src/renderer/pages/settings/PermissionsSettingsPage.tsx'],
    tests: 'packages/core/src/rox2/__tests__/platform-contract.test.ts',
    acceptance: [`${perm} cannot run silently in ask/safe`],
    rollback: 'Keep allow-all as the session default; still type the grant.',
    evidence: 'new-requirement',
  }))
}

function rpcDrafts(): Draft[] {
  // meetings.ts is mixed Conation leftover, not a native RPC card. Keep the
  // 200-card leftover ids stable; do not treat a handler DTO as live Mail.
  const files = rpcHandlerFiles().filter(
    (file) => !file.endsWith('memory-test-setup.ts') && !file.endsWith('meetings.ts'),
  )
  return files.map((file) => {
    const name = file.split('/').pop() ?? file
    return {
      title: `RPC ${name}: return live vs queued explicitly`,
      wave: 8,
      domain: 'rpc' as const,
      asIs: `${name} returns ad-hoc payloads. Callers may treat presence of a DTO as success.`,
      toBe: `Wrap new mutating paths in Rox2Result. Tests fail if a fixture/queued payload is labeled live.`,
      files: [file, CONTRACT],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: [`${name} mutating tests name the run state`],
      rollback: `Keep ${name} payloads; add the wrapper later.`,
      evidence: 'statically-confirmed',
    }
  })
}

function leftoverDrafts(): Draft[] {
  return [
    {
      title: 'Cloud Runs are native, not Conation',
      wave: 9,
      domain: 'service',
      asIs: 'CloudRunsSettingsPage is native. Auth/WS follow-ups remain.',
      toBe: 'Cloud run spend uses spend permission. Do not proxy them through Conation.',
      files: [
        'apps/electron/src/renderer/pages/settings/CloudRunsSettingsPage.tsx',
        'packages/server-core/src/handlers/rpc/cloud-runs.ts',
      ],
      tests: 'packages/server-core/src/handlers/rpc/cloud-runs.test.ts',
      acceptance: ['Cloud Runs remain a native settings surface'],
      rollback: 'Keep page.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Voice overlay is native, not Conation',
      wave: 9,
      domain: 'screen',
      asIs: 'voice-overlay.tsx and voice RPC exist. Voice v2 issues were closed separately.',
      toBe: 'Voice stays a native host. Mic access is device-read.',
      files: [
        'apps/electron/src/renderer/voice-overlay.tsx',
        'packages/server-core/src/handlers/rpc/voice.ts',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Voice is not a Conation pane'],
      rollback: 'No voice rewrite.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Web UI parity is not desktop completion',
      wave: 9,
      domain: 'screen',
      asIs: 'apps/webui/src/App.tsx. Parity hygiene was a next-program ticket.',
      toBe: 'Web UI consumes the same Rox2 contract. Missing surfaces stay listed, not faked.',
      files: ['apps/webui/src/App.tsx'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Web UI is inventoried separately from Electron'],
      rollback: 'No webui rewrite in wave 0.',
      evidence: 'statically-confirmed',
    },
    {
      title: 'Extension host crash isolation remains unfinished shell work',
      wave: 9,
      domain: 'service',
      asIs: 'unfinished-initiatives.md: crash isolation/restart UX for Extension Host is leftover.',
      toBe: 'Do not call unified shell complete. Isolation is a later card.',
      files: ['docs/unfinished-initiatives.md', 'packages/server-core/src/handlers/rpc/extensions.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Shell leftovers stay open'],
      rollback: 'No false complete.',
      evidence: 'documented',
    },
    {
      title: 'Connection fabric recovery is leftover',
      wave: 9,
      domain: 'service',
      asIs: 'fabric.ts + fabric-runtime.ts. Recovery/import hardening leftover.',
      toBe: 'Fabric recovery is a later card. Connections still work for MCP sources.',
      files: [
        'packages/server-core/src/handlers/rpc/fabric.ts',
        'packages/server-core/src/handlers/rpc/fabric-runtime.ts',
      ],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Fabric is not claimed fully hardened'],
      rollback: 'No fabric rewrite in wave 0.',
      evidence: 'documented',
    },
    {
      title: 'Native substrate remains opt-in',
      wave: 9,
      domain: 'service',
      asIs: 'Native substrate is opt-in with deferred services.',
      toBe: 'ROX2 does not require native substrate. Cards that need it say so.',
      files: ['docs/unfinished-initiatives.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['Substrate stays opt-in'],
      rollback: 'No default flip.',
      evidence: 'documented',
    },
    {
      title: 'Identity irreversible IDs stay blocked',
      wave: 9,
      domain: 'identity',
      asIs: 'Identity migration leftovers: irreversible identifiers, OAuth, deep links.',
      toBe: 'ROX2 copy can say Rox. IDs stay. Website client-id flip stays human-blocked.',
      files: ['docs/unfinished-initiatives.md', 'plans/next-program/decisions/005-website-client-id.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['No protocol ID rewrite'],
      rollback: 'Do not migrate IDs.',
      evidence: 'documented',
    },
    {
      title: 'Branch hygiene stays human-gated',
      wave: 9,
      domain: 'identity',
      asIs: 'decision 006 forbids agent remote branch deletion.',
      toBe: 'ROX2 agents never delete remotes. Inventory only.',
      files: ['plans/next-program/decisions/006-branch-deletion.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['No remote branch deletion'],
      rollback: 'Do not delete remote branches.',
      evidence: 'documented',
    },
    {
      title: 'Emit machine-readable registry JSON',
      wave: 9,
      domain: 'audit',
      asIs: 'TypeScript registry is SoT.',
      toBe: 'plans/rox2/registry.json is emitted and checked into git for other agents.',
      files: ['plans/rox2/registry.ts', 'plans/rox2/emit.ts'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['registry.json matches buildRox2Cards()'],
      rollback: 'Delete JSON; keep TS.',
      evidence: 'new-requirement',
    },
    {
      title: 'Closeout: issue #315 accepts inventory, not product completion',
      wave: 9,
      domain: 'wave',
      asIs: 'Issue #315 is the program charter.',
      toBe: 'Closing #315 means the inventory, gap matrix, contract, 200 cards, and wave plan exist. It does not mean Drive/Mail/CRM/Tasks are live Conation integrations.',
      files: ['plans/rox2/README.md'],
      tests: 'plans/rox2/__tests__/program.test.ts',
      acceptance: ['README states #315 closeout ≠ product complete'],
      rollback: 'Leave issue open if artifacts missing.',
      evidence: 'new-requirement',
    },
  ]
}

export function buildRox2Cards(): Rox2Card[] {
  const drafts: Draft[] = [
    ...programDrafts(),
    ...screenDrafts(),
    ...settingsDrafts(),
    ...conationDrafts(),
    ...notesDrafts(),
    ...calendarDrafts(),
    ...contextDrafts(),
    ...memoryDrafts(),
    ...collabDrafts(),
    ...permissionDrafts(),
    ...rpcDrafts(),
    ...leftoverDrafts(),
  ]
  return drafts.map((draft, index) => card(index + 1, draft))
}
