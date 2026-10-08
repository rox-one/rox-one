/** W1-10 (#1507) — migration fixtures (synthetic; golden inputs for W1-06). */

export interface V2PersonalTask {
  id: string
  title: string
  done: boolean
  schemaVersion: 2
  dueDate?: string
}

export const V2_TASKS_FIXTURE: V2PersonalTask[] = [
  { id: 'task-001', title: 'Buy milk', done: false, schemaVersion: 2 },
  { id: 'task-002', title: 'Ship report', done: true, schemaVersion: 2, dueDate: '2026-10-01' },
  { id: 'task-003', title: 'Позвонить в банк', done: false, schemaVersion: 2, dueDate: '2026-10-09' },
]

export interface OkrJson {
  cycles: Array<{ id: string; name: string; period: string }>
  objectives: Array<{ id: string; title: string; cycleId: string; projectId?: string }>
  keyResults: Array<{ id: string; objectiveId: string; title: string; target: number; current: number }>
}

export const OKR_JSON_FIXTURE: OkrJson = {
  cycles: [{ id: 'cycle-q4', name: 'Q4 2026', period: '2026-Q4' }],
  objectives: [
    { id: 'obj-retention', title: 'Q4 retention', cycleId: 'cycle-q4', projectId: 'project-onboarding' },
    { id: 'obj-latency', title: 'Latency under 150ms p95', cycleId: 'cycle-q4' },
  ],
  keyResults: [
    { id: 'kr-1', objectiveId: 'obj-retention', title: 'Weekly retention 40%', target: 40, current: 32 },
    { id: 'kr-2', objectiveId: 'obj-latency', title: 'p95 API latency', target: 150, current: 210 },
  ],
}

export interface RoadmapJson {
  milestones: Array<{ id: string; title: string; dueDate: string; taskIds: string[] }>
}

export const ROADMAP_JSON_FIXTURE: RoadmapJson = {
  milestones: [
    { id: 'ms-mvp', title: 'MVP', dueDate: '2026-11-01', taskIds: ['task-001'] },
    { id: 'ms-ga', title: 'GA', dueDate: '2027-01-15', taskIds: ['task-002', 'task-003'] },
  ],
}

export interface DossierDump {
  version: 1
  contacts: Array<{ id: string; name: string; note?: string; tags: string[] }>
}

export const DOSSIER_DUMP_FIXTURE: DossierDump = {
  version: 1,
  contacts: [
    { id: 'contact-oleg', name: 'Oleg', note: 'Contractor', tags: ['contractor'] },
    { id: 'contact-anna', name: 'Anna', tags: ['design'] },
  ],
}

/** Every TipTap node type the vault-notes fixture must cover. */
export const TIPTAP_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'mention',
  'entityRef',
  'entityEmbed',
  'taskBlock',
  'eventBlock',
  'meetingBlock',
] as const

export interface VaultNoteFixture {
  path: string
  markdown: string
  tiptap: { type: 'doc'; content: unknown[] }
  coveredNodes: readonly string[]
}

function tiptapDoc(nodes: Array<{ type: string; [k: string]: unknown }>): { type: 'doc'; content: unknown[] } {
  return { type: 'doc', content: nodes }
}

/** Vault notes covering every TipTap node type incl. explicit link syntax. */
export const VAULT_NOTES_FIXTURE: VaultNoteFixture[] = [
  {
    path: 'notes/retro.md',
    markdown: [
      '# Retro',
      '',
      'Discussed with [[goal:retention|Q4 retention]] and ![[task:task-001]] in chat.',
      '',
      '- [ ] Follow up with @bob',
      '- [x] Ship the report',
      '',
      '> A quote worth keeping',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n'),
    tiptap: tiptapDoc([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Retro' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Discussed with ' },
          { type: 'entityRef', attrs: { kind: 'goal', id: 'retention', label: 'Q4 retention' } },
          { type: 'text', text: ' and ' },
          { type: 'entityEmbed', attrs: { kind: 'task', id: 'task-001' } },
          { type: 'text', text: ' in chat.' },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Follow up with ' },
                  { type: 'mention', attrs: { id: 'bob', label: '@bob' } },
                ],
              },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship the report' }] }],
          },
        ],
      },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quote worth keeping' }] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }],
      },
      { type: 'image', attrs: { src: 'rox://file/shot-1', alt: 'screenshot' } },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'point' }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }] },
      { type: 'taskBlock', attrs: { ref: 'task:task-002' } },
      { type: 'eventBlock', attrs: { ref: 'calendar-event:design-review' } },
      { type: 'meetingBlock', attrs: { ref: 'meeting:weekly' } },
    ]),
    coveredNodes: TIPTAP_NODE_TYPES,
  },
]
