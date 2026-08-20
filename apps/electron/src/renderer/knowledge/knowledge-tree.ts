export type NavFilter = 'all' | 'notes' | 'databases'

export interface SiyuanDocTreeNode {
  id: string
  name: string
  path: string
  kind: 'document' | 'folder' | 'database'
  children?: SiyuanDocTreeNode[]
}

function cloneNode(node: SiyuanDocTreeNode, children?: SiyuanDocTreeNode[]): SiyuanDocTreeNode {
  const next: SiyuanDocTreeNode = { id: node.id, name: node.name, path: node.path, kind: node.kind }
  if (children && children.length > 0) next.children = children
  else if (node.kind === 'folder' && children) next.children = children
  return next
}

export function filterTree(nodes: SiyuanDocTreeNode[], filter: NavFilter): SiyuanDocTreeNode[] {
  if (filter === 'all') return nodes
  const out: SiyuanDocTreeNode[] = []
  for (const node of nodes) {
    if (filter === 'notes') {
      if (node.kind === 'database') continue
      const kids = node.children ? filterTree(node.children, filter) : undefined
      if (node.kind === 'folder') {
        if (kids && kids.length > 0) out.push(cloneNode(node, kids))
        continue
      }
      out.push(kids ? cloneNode(node, kids) : { ...node })
      continue
    }
    // databases
    if (node.kind === 'database') {
      out.push({ ...node })
      continue
    }
    const kids = node.children ? filterTree(node.children, filter) : []
    if (kids.length > 0) out.push(cloneNode(node, kids))
  }
  return out
}

export function collectDatabases(nodes: SiyuanDocTreeNode[]): SiyuanDocTreeNode[] {
  const found: SiyuanDocTreeNode[] = []
  const walk = (list: SiyuanDocTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'database') found.push(node)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return found
}
