const visibleVerticesMap = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
const EMPTY_SET = new Set<string>();

function notify(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* noop */ }
  }
}

export function subscribeToVisibleVertices(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getVisibleVertexIds(graphId: string): Set<string> {
  return visibleVerticesMap.get(graphId) ?? EMPTY_SET;
}

export function hasVisibleVertexEntry(graphId: string): boolean {
  return visibleVerticesMap.has(graphId);
}

export function setAllVerticesVisible(graphId: string, ids: string[], silent?: boolean): void {
  visibleVerticesMap.set(graphId, new Set(ids));
  if (!silent) {
    notify();
  } else {
    queueMicrotask(notify);
  }
}

export function toggleVisibleVertex(graphId: string, vertexId: string, visible: boolean): void {
  const set = visibleVerticesMap.get(graphId);
  if (!set) return;
  const next = new Set(set);
  if (visible) next.add(vertexId);
  else next.delete(vertexId);
  visibleVerticesMap.set(graphId, next);
  notify();
}
