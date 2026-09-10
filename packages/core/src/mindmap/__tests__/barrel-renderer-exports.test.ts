import { describe, expect, test } from 'bun:test';
import {
  createMindMapStarterGraph,
  extractSessionVariables,
  pruneSessionMapPin,
  addPinnedCustomNode,
} from '../index.ts';

describe('mindmap barrel re-exports renderer symbols', () => {
  test('session map, variables, starter graph, and pinned edit are value exports', () => {
    expect(typeof extractSessionVariables).toBe('function');
    expect(typeof pruneSessionMapPin).toBe('function');
    expect(typeof createMindMapStarterGraph).toBe('function');
    expect(typeof addPinnedCustomNode).toBe('function');
  });
});
