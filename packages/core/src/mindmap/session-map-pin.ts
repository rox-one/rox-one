export type SessionMapCamera = 'map' | 'flow';

export type SessionMapPin = {
  v: 1;
  sessionId: string;
  camera: SessionMapCamera;
  viewport?: { x: number; y: number; zoom: number };
  nodes: Record<string, { x: number; y: number }>;
};

export function sessionMapPinStorageKey(sessionId: string): string {
  return `rox.sessionMap.layout.${sessionId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseViewport(value: unknown): { x: number; y: number; zoom: number } | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.zoom)) {
    return undefined;
  }
  return { x: value.x, y: value.y, zoom: value.zoom };
}

function parseNodes(value: unknown): Record<string, { x: number; y: number }> | null {
  if (!isRecord(value)) return null;
  const nodes: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(value)) {
    if (!isRecord(pos) || !isFiniteNumber(pos.x) || !isFiniteNumber(pos.y)) continue;
    nodes[id] = { x: pos.x, y: pos.y };
  }
  return nodes;
}

export function parseSessionMapPin(
  raw: string | null | undefined,
  sessionId: string,
): SessionMapPin | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== 1) return null;
  if (typeof parsed.sessionId !== 'string' || parsed.sessionId !== sessionId) return null;
  if (parsed.camera !== 'map' && parsed.camera !== 'flow') return null;
  const nodes = parseNodes(parsed.nodes);
  if (!nodes) return null;

  const pin: SessionMapPin = {
    v: 1,
    sessionId: parsed.sessionId,
    camera: parsed.camera,
    nodes,
  };
  if ('viewport' in parsed) {
    const viewport = parseViewport(parsed.viewport);
    if (!viewport) return null;
    pin.viewport = viewport;
  }
  return pin;
}

export function serializeSessionMapPin(pin: SessionMapPin): string {
  return JSON.stringify(pin);
}

export function pruneSessionMapPin(
  pin: SessionMapPin,
  knownSceneIds: ReadonlySet<string>,
): SessionMapPin {
  const nodes: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(pin.nodes)) {
    if (knownSceneIds.has(id)) nodes[id] = pos;
  }
  const next: SessionMapPin = {
    v: pin.v,
    sessionId: pin.sessionId,
    camera: pin.camera,
    nodes,
  };
  if (pin.viewport) next.viewport = pin.viewport;
  return next;
}
