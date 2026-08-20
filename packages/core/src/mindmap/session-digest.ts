import type { SessionScene, SessionSceneGraph } from './session-scene-graph.ts';

export type DigestShelf = 'decisions' | 'artifacts' | 'open' | 'pinned';

export type DigestItem = {
  id: string;
  shelf: DigestShelf;
  sceneId: string;
  messageId: string;
  title: string;
  reason: string;
};

export const DIGEST_PIN_STORAGE_KEY = 'rox.sessionDigest.pins';

export function digestPinStorageKey(sessionId: string): string {
  return `${DIGEST_PIN_STORAGE_KEY}.${sessionId}`;
}

export function parsePinnedSceneIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function serializePinnedSceneIds(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

const DECISION_RE = /переделай|иначе|fork|restart|instead/i;
const ARTIFACT_RE = /write|edit|bash|read|apply_patch/i;

function titleOf(scene: SessionScene): string {
  return scene.triggerPreview.slice(0, 80) || scene.id;
}

export function buildDigestItems(
  graph: SessionSceneGraph,
  pinnedSceneIds: string[] = [],
): DigestItem[] {
  const items: DigestItem[] = [];
  const pinned = new Set(pinnedSceneIds);

  for (const scene of graph.scenes) {
    const isFork = scene.childSceneIds.length > 1;
    if (isFork || DECISION_RE.test(scene.triggerPreview)) {
      items.push({
        id: `dec_${scene.id}`,
        shelf: 'decisions',
        sceneId: scene.id,
        messageId: scene.triggerMessageId,
        title: titleOf(scene),
        reason: 'форк',
      });
    }
    const artifact = scene.tools.find((t) => t.status !== 'error' && ARTIFACT_RE.test(t.name));
    if (artifact) {
      items.push({
        id: `art_${scene.id}_${artifact.toolCallId}`,
        shelf: 'artifacts',
        sceneId: scene.id,
        messageId: artifact.messageId,
        title: titleOf(scene),
        reason: `инструмент ${artifact.name}`,
      });
    }
    const blocked = scene.tools.some((t) => t.status === 'error' || t.status === 'pending');
    if (scene.assistantMessageIds.length === 0 || blocked) {
      items.push({
        id: `open_${scene.id}`,
        shelf: 'open',
        sceneId: scene.id,
        messageId: scene.triggerMessageId,
        title: titleOf(scene),
        reason: blocked ? 'ошибка' : 'ожидает ответа',
      });
    }
    if (pinned.has(scene.id)) {
      items.push({
        id: `pin_${scene.id}`,
        shelf: 'pinned',
        sceneId: scene.id,
        messageId: scene.triggerMessageId,
        title: titleOf(scene),
        reason: 'закреплено',
      });
    }
  }

  const order: Record<DigestShelf, number> = {
    decisions: 0,
    artifacts: 1,
    open: 2,
    pinned: 3,
  };
  items.sort((a, b) => order[a.shelf] - order[b.shelf] || a.id.localeCompare(b.id));
  return items;
}
