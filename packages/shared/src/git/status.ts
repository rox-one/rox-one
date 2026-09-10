/**
 * Parse `git status --porcelain=v1 -b` into a workspace snapshot.
 * Pure: no child_process. Handlers exec git and pass stdout here.
 */
export interface GitStatusEntry {
  path: string
  index: string
  worktree: string
}

export interface GitWorkingTreeStatus {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  entries: GitStatusEntry[]
}

const EMPTY: GitWorkingTreeStatus = {
  isRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  entries: [],
}

export function emptyGitWorkingTreeStatus(): GitWorkingTreeStatus {
  return { ...EMPTY, entries: [] }
}

export function parseGitPorcelainV1(output: string): GitWorkingTreeStatus {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length === 0) return emptyGitWorkingTreeStatus()

  let branch: string | null = null
  let ahead = 0
  let behind = 0
  const entries: GitStatusEntry[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const rest = line.slice(3)
      const nameToken = rest.split('...')[0]?.trim() ?? ''
      branch = nameToken.length > 0 ? nameToken : null
      const aheadMatch = rest.match(/ahead (\d+)/)
      const behindMatch = rest.match(/behind (\d+)/)
      if (aheadMatch) ahead = Number(aheadMatch[1])
      if (behindMatch) behind = Number(behindMatch[1])
      continue
    }
    if (line.length < 4) continue
    entries.push({
      index: line[0] ?? ' ',
      worktree: line[1] ?? ' ',
      path: line.slice(3),
    })
  }

  return { isRepo: true, branch, ahead, behind, entries }
}
