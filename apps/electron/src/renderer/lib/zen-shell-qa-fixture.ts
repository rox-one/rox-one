/**
 * Zen Shell QA fixture data (ZS-08).
 *
 * ≥500 sidebar rows, nested sections, long Russian titles, two content panels.
 * Pure data — the playground story mounts the interactive chrome.
 */

export const ZEN_SHELL_QA_MIN_ROWS = 500
export const ZEN_SHELL_QA_NESTED_DEPTH = 2
export const ZEN_SHELL_QA_PANEL_COUNT = 2
export const ZEN_SHELL_QA_LONG_RU_TITLE =
  'Проект «Северо-Западная исследовательская экспедиция по документированию наследия» — черновик согласования с приложением'

export interface ZenShellQaRow {
  id: string
  title: string
  depth: number
  parentId: string | null
  expandable: boolean
  childIds: string[]
}

export interface ZenShellQaFixture {
  rows: ZenShellQaRow[]
  nestedSectionCount: number
  panelCount: typeof ZEN_SHELL_QA_PANEL_COUNT
  longTitle: string
}

const ROOT_SECTIONS = [
  'Проекты',
  'Архив согласований',
  'Черновики экспедиций',
] as const

export function buildZenShellQaFixture(rowCount = ZEN_SHELL_QA_MIN_ROWS): ZenShellQaFixture {
  const count = Math.max(rowCount, ZEN_SHELL_QA_MIN_ROWS)
  const rows: ZenShellQaRow[] = []
  const byId = new Map<string, ZenShellQaRow>()

  function add(row: ZenShellQaRow): void {
    rows.push(row)
    byId.set(row.id, row)
    if (row.parentId) {
      byId.get(row.parentId)?.childIds.push(row.id)
    }
  }

  for (const [index, title] of ROOT_SECTIONS.entries()) {
    add({
      id: `section-${index}`,
      title,
      depth: 0,
      parentId: null,
      expandable: true,
      childIds: [],
    })
  }

  let leaf = 0
  while (rows.length < count) {
    const rootIndex = leaf % ROOT_SECTIONS.length
    const groupId = `group-${rootIndex}-${Math.floor(leaf / ROOT_SECTIONS.length)}`
    if (!byId.has(groupId)) {
      add({
        id: groupId,
        title: `${ZEN_SHELL_QA_LONG_RU_TITLE} · группа ${rootIndex + 1}.${Math.floor(leaf / ROOT_SECTIONS.length) + 1}`,
        depth: 1,
        parentId: `section-${rootIndex}`,
        expandable: true,
        childIds: [],
      })
    }
    add({
      id: `row-${leaf}`,
      title: `${ZEN_SHELL_QA_LONG_RU_TITLE} №${String(leaf + 1).padStart(3, '0')}`,
      depth: ZEN_SHELL_QA_NESTED_DEPTH,
      parentId: groupId,
      expandable: false,
      childIds: [],
    })
    leaf += 1
  }

  const nestedSectionCount = rows.filter((row) => row.expandable && row.depth > 0).length
  return {
    rows,
    nestedSectionCount,
    panelCount: ZEN_SHELL_QA_PANEL_COUNT,
    longTitle: ZEN_SHELL_QA_LONG_RU_TITLE,
  }
}
