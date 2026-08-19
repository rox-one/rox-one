import { describe, expect, it } from 'bun:test';

import { MutationValidationError } from '../../../mutations.ts';
import { SiyuanKernelClient } from '../client.ts';

type PostFn = (endpoint: string, body: Record<string, unknown>) => Promise<unknown>;

function clientWithPost(post: PostFn): SiyuanKernelClient {
  const client = new SiyuanKernelClient({
    token: 'tok',
    baseUrl: 'http://127.0.0.1:6806',
    fetchImpl: (async () => {
      throw new Error('fetch should not be called when post is mocked');
    }) as unknown as typeof fetch,
  });
  (client as unknown as { post: PostFn }).post = post;
  return client;
}

describe('SiyuanKernelClient.listDocTree', () => {
  it('maps folders and documents from listDocsByPath', async () => {
    const posts: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
    const client = clientWithPost(async (endpoint, body) => {
      posts.push({ endpoint, body });
      if (endpoint === '/api/filetree/listDocsByPath') {
        return {
          box: 'nb-1',
          path: '/',
          files: [
            { id: 'folder-1', name: 'Research', path: '/20260807-folder', subFileCount: 2 },
            { id: 'doc-1', name: 'Craft Spec', path: '/20260807-doc.sy', subFileCount: 0 },
          ],
        };
      }
      if (endpoint === '/api/query/sql') return [];
      throw new Error(`unexpected endpoint ${endpoint}`);
    });

    const result = await client.listDocTree('nb-1');
    expect(result.notebookId).toBe('nb-1');
    expect(posts[0]).toEqual({
      endpoint: '/api/filetree/listDocsByPath',
      body: { notebook: 'nb-1', path: '/' },
    });
    expect(result.nodes).toEqual([
      { id: 'folder-1', name: 'Research', path: '/20260807-folder', kind: 'folder', children: [] },
      { id: 'doc-1', name: 'Craft Spec', path: '/20260807-doc.sy', kind: 'document' },
    ]);
    expect(String(posts[1]?.body['stmt'])).toMatch(/^\s*SELECT\b/i);
    expect(String(posts[1]?.body['stmt'])).toContain("type='av'");
    expect(posts[1]?.body['mode']).toBe('readonly');
  });

  it("merges av rows as kind: 'database'", async () => {
    const client = clientWithPost(async (endpoint) => {
      if (endpoint === '/api/filetree/listDocsByPath') {
        return {
          files: [{ id: 'doc-1', name: 'Notes', path: '/20260807-doc.sy', subFileCount: 0 }],
        };
      }
      if (endpoint === '/api/query/sql') {
        return [
          {
            id: 'av-1',
            name: 'Reservations',
            path: '/20260807-doc.sy',
            hpath: '/Notes',
            box: 'nb-1',
          },
        ];
      }
      throw new Error(`unexpected endpoint ${endpoint}`);
    });

    const result = await client.listDocTree('nb-1');
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.kind).toBe('document');
    expect(result.nodes[0]!.children).toEqual([
      { id: 'av-1', name: 'Reservations', path: '/Notes', kind: 'database' },
    ]);
  });

  it('querySql rejects non-SELECT before post', async () => {
    let posted = false;
    const client = clientWithPost(async () => {
      posted = true;
      return [];
    });
    expect(posted).toBe(false);
    try {
      await client.querySql('DELETE FROM blocks');
      throw new Error('expected querySql to reject non-SELECT');
    } catch (error) {
      expect(error).toBeInstanceOf(MutationValidationError);
    }
    expect(posted).toBe(false);
  });
});
