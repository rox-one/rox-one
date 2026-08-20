/**
 * Pure helpers for Cmd+N / File→New Chat in Knowledge mode:
 * pick an open notebook and build knowledge.userCreate document args.
 */

export interface NotebookPickInput {
  id: string
  closed?: boolean
}

export function pickOpenNotebook<T extends NotebookPickInput>(notebooks: T[]): T | undefined {
  if (notebooks.length === 0) return undefined
  return notebooks.find((notebook) => notebook.closed !== true) ?? notebooks[0]
}

export function buildNewDocumentCreateArgs(input: {
  connectionId: string
  notebookId: string
  title: string
}): {
  connectionId: string
  source: 'navigator'
  op: 'document'
  notebookId: string
  title: string
} {
  return {
    connectionId: input.connectionId,
    source: 'navigator',
    op: 'document',
    notebookId: input.notebookId,
    title: input.title,
  }
}
