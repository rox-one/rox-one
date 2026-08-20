import type { MindMapSessionMessage } from './derive-session.ts';

export type SceneToolStatus = 'ok' | 'error' | 'pending' | 'unknown';

/** Aligns with runtime Message / stored rows. Nesting via parentToolUseId. */
export type SceneMessage = {
  id: string;
  type?: string;
  role?: string;
  content: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string;
  toolStatus?: string;
  status?: string;
};

export type SceneToolPacket = {
  toolCallId: string;
  name: string;
  status: SceneToolStatus;
  messageId: string;
};

export type SessionScene = {
  id: string;
  triggerMessageId: string;
  triggerPreview: string;
  outcomePreview: string;
  assistantMessageIds: string[];
  tools: SceneToolPacket[];
  parentSceneId: string | null;
  childSceneIds: string[];
  orphaned: boolean;
};

export type SceneEdge = {
  from: string;
  to: string;
  kind: 'continue' | 'fork';
};

export type SessionSceneGraph = {
  sessionId: string;
  scenes: SessionScene[];
  edges: SceneEdge[];
};

const SKIP = new Set(['status', 'info', 'warning']);

function preview(text: string, n: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, n);
}

function roleOf(msg: SceneMessage): string {
  return String(msg.type || msg.role || '').toLowerCase();
}

function toolStatusOf(msg: SceneMessage): SceneToolStatus {
  const raw = String(msg.toolStatus ?? msg.status ?? '').toLowerCase();
  if (raw === 'ok' || raw === 'completed' || raw === 'success') return 'ok';
  if (raw === 'error' || raw === 'failed') return 'error';
  if (raw === 'pending' || raw === 'running' || raw === 'executing') return 'pending';
  return 'unknown';
}

function wouldCycle(
  scenes: Map<string, SessionScene>,
  childId: string,
  parentId: string,
): boolean {
  let cur: string | null = parentId;
  const seen = new Set<string>([childId]);
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = scenes.get(cur)?.parentSceneId ?? null;
  }
  return false;
}

export function projectSessionScenes(
  sessionId: string,
  messages: ReadonlyArray<SceneMessage | MindMapSessionMessage>,
): SessionSceneGraph {
  if (!messages.length) return { sessionId, scenes: [], edges: [] };

  const scenes: SessionScene[] = [];
  const byId = new Map<string, SessionScene>();
  const sceneByToolUseId = new Map<string, SessionScene>();
  let open: SessionScene | null = null;
  let previous: SessionScene | null = null;

  const attachParent = (scene: SessionScene, parent: SessionScene | null) => {
    if (!parent || parent.id === scene.id || wouldCycle(byId, scene.id, parent.id)) {
      scene.parentSceneId = null;
      if (!parent && scenes.length > 1) scene.orphaned = true;
      return;
    }
    scene.parentSceneId = parent.id;
    scene.orphaned = false;
  };

  for (const raw of messages) {
    const msg = raw as SceneMessage;
    const role = roleOf(msg);
    if (SKIP.has(role)) continue;

    if (role === 'user') {
      const scene: SessionScene = {
        id: `scn_${msg.id}`,
        triggerMessageId: msg.id,
        triggerPreview: preview(msg.content, 80),
        outcomePreview: '',
        assistantMessageIds: [],
        tools: [],
        parentSceneId: null,
        childSceneIds: [],
        orphaned: false,
      };
      scenes.push(scene);
      byId.set(scene.id, scene);

      let parent: SessionScene | null = null;
      if (msg.parentToolUseId) {
        parent = sceneByToolUseId.get(msg.parentToolUseId) ?? null;
        if (!parent) scene.orphaned = true;
      } else {
        parent = previous;
      }
      attachParent(scene, parent);
      open = scene;
      previous = scene;
      continue;
    }

    let target = open;
    if (msg.parentToolUseId) {
      target = sceneByToolUseId.get(msg.parentToolUseId) ?? target;
    }
    if (!target) {
      target = {
        id: `scn_orphan_${msg.id}`,
        triggerMessageId: msg.id,
        triggerPreview: preview(msg.content || role, 80),
        outcomePreview: '',
        assistantMessageIds: [],
        tools: [],
        parentSceneId: null,
        childSceneIds: [],
        orphaned: true,
      };
      scenes.push(target);
      byId.set(target.id, target);
      open = target;
      previous = previous ?? target;
    }

    if (role === 'assistant' || role === 'thinking' || role === 'plan') {
      target.assistantMessageIds.push(msg.id);
      if (msg.content) target.outcomePreview = preview(msg.content, 140);
      continue;
    }

    if (role === 'tool') {
      const toolCallId = msg.toolUseId || msg.id;
      target.tools.push({
        toolCallId,
        name: msg.toolName || 'tool',
        status: toolStatusOf(msg),
        messageId: msg.id,
      });
      sceneByToolUseId.set(toolCallId, target);
    }
  }

  const children = new Map<string, string[]>();
  for (const scene of scenes) {
    if (!scene.parentSceneId || !byId.has(scene.parentSceneId)) {
      if (scene.parentSceneId && !byId.has(scene.parentSceneId)) {
        scene.parentSceneId = null;
        scene.orphaned = true;
      }
      continue;
    }
    const list = children.get(scene.parentSceneId) ?? [];
    list.push(scene.id);
    children.set(scene.parentSceneId, list);
  }

  const edges: SceneEdge[] = [];
  for (const scene of scenes) {
    const kids = children.get(scene.id) ?? [];
    scene.childSceneIds = kids;
    const kind: SceneEdge['kind'] = kids.length > 1 ? 'fork' : 'continue';
    for (const child of kids) edges.push({ from: scene.id, to: child, kind });
  }

  return { sessionId, scenes, edges };
}

export const FANOUT_PARALLEL = 8;
export const FANOUT_MAX = 32;

export function planFanOutJobs(
  variantsLength: number,
  count: number,
): { total: number; parallelCap: number } {
  const total = variantsLength * count;
  if (total < 1) throw new Error('empty');
  if (total > FANOUT_MAX) throw new Error('cap');
  return { total, parallelCap: FANOUT_PARALLEL };
}

export function initialFanOutStatuses(total: number): Array<'running' | 'queued'> {
  return Array.from({ length: total }, (_, i) => (i < FANOUT_PARALLEL ? 'running' : 'queued'));
}
