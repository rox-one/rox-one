import { addChild, addEdge, createEmptyGraph, finalizeGraph, truncateLabel } from './graph.ts';
import { headingsToTree, parseOutlineHeadings } from './outline.ts';
import type { MindMapGraph } from './types.ts';
import { retainedSourceHash } from '../docs/retained-source.ts';
import type { ListTreeProjection } from '../docs/list-tree.ts';

export interface MindMapNoteBacklink {
  id: string;
  title: string;
}

export interface MindMapNoteInput {
  noteId: string;
  title: string;
  markdown: string;
  backlinks?: MindMapNoteBacklink[];
  /** Supplied only from the committed, authorized native block projection. */
  listTree?: ListTreeProjection;
}

export function deriveNoteMindMap(input: MindMapNoteInput): MindMapGraph {
  const rootLabel = input.title.trim() || 'Note';
  const graph = createEmptyGraph({ type: 'note', noteId: input.noteId }, rootLabel);

  if (input.listTree) {
    const tree = input.listTree;
    if (tree.sourceHash !== retainedSourceHash(input.markdown)) return finalizeGraph(graph, 'note');
    const root = graph.nodes[graph.rootId];
    if (!root) return finalizeGraph(graph, 'note');
    root.meta = { sourceHash: tree.sourceHash, authorityEpoch: tree.authorityEpoch, markerMappingVersion: tree.markerMappingVersion };
    if (tree.root?.nodeId) root.source = { kind: 'block', id: tree.root.nodeId };
    for (const node of tree.nodes) {
      // Snapshot-local IDs distinguish unanchored rows without claiming stable source identity.
      const id = node.nodeId ? 'block:' + node.nodeId : 'projection:' + tree.sourceHash + ':' + node.blockIndex;
      const parent = node.parentIndex === null ? graph.rootId : tree.nodes[node.parentIndex];
      const parentId = typeof parent === 'string' ? parent : parent
        ? parent.nodeId ? 'block:' + parent.nodeId : 'projection:' + tree.sourceHash + ':' + parent.blockIndex : graph.rootId;
      addChild(graph, parentId, { id, label: truncateLabel(node.text, 120), kind: 'block', level: node.level + 1,
        ...(node.identity === 'anchored' && node.nodeId ? { source: { kind: 'block', id: node.nodeId } } : {}),
        meta: { sourceHash: tree.sourceHash, authorityEpoch: tree.authorityEpoch, identity: node.identity,
          ...(node.checkbox === undefined ? {} : { checked: node.checkbox }) } });
    }
  } else {
  const headings = parseOutlineHeadings(input.markdown);
  if (headings.length > 0) {
    headingsToTree(graph, headings, graph.rootId);
  } else {
    const body = input.markdown.trim();
    if (body) {
      addChild(graph, graph.rootId, {
        id: 'section:body',
        label: truncateLabel(body, 120),
        kind: 'section',
        source: { kind: 'section', id: 'body' },
      });
    }
  }

  }

  for (const bl of input.backlinks ?? []) {
    const id = `backlink:${bl.id}`;
    addChild(graph, graph.rootId, {
      id,
      label: bl.title.trim() || bl.id,
      kind: 'backlink',
      source: { kind: 'note', id: bl.id },
    });
    // Secondary edge kind for renderers that style backlinks distinctly.
    addEdge(graph, graph.rootId, id, 'backlink');
  }

  return finalizeGraph(graph, 'note');
}

/** Notes routes encode the whole address as their note parameter. */
export function parseNoteBlockAddress(address: string): { noteId: string; blockId?: string } {
  const match = /^(.*)#\^([A-Za-z0-9_-]+)$/.exec(address);
  return match && match[1] && match[2] ? { noteId: match[1], blockId: match[2] } : { noteId: address };
}

/** Resolve aliases only within an already authorized source projection. */
export function resolveNoteBlockId(tree: ListTreeProjection, blockId: string): string | null {
  const matches = tree.mappings.filter(mapping => mapping.blockId === blockId || mapping.nodeId === blockId);
  const ids = new Set(matches.map(mapping => mapping.nodeId));
  return ids.size === 1 ? [...ids][0] ?? null : null;
}
