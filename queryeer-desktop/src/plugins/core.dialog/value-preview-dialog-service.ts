type ValuePreviewDialogOptions = {
  title: string;
  value: string;
  mimeType?: string;
};

export type ValuePreviewWindowState = ValuePreviewDialogOptions & {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
};

type Listener = () => void;

let nextId = 1;
let nextZ = 1;
let openWindows: ValuePreviewWindowState[] = [];
let focusedWindowId: string | null = null;
const listeners = new Set<Listener>();

export function requestValuePreviewDialog(options: ValuePreviewDialogOptions): Promise<void> {
  const offset = (nextId - 1) % 8;
  const windowState: ValuePreviewWindowState = {
    id: `value-preview-${nextId++}`,
    title: options.title,
    value: options.value,
    mimeType: options.mimeType,
    x: 24 + (offset * 20),
    y: 24 + (offset * 18),
    width: 680,
    height: 420,
    zIndex: nextZ++,
    minimized: false,
  };
  openWindows = [...openWindows, windowState];
  focusedWindowId = windowState.id;
  emitChanged();
  return Promise.resolve();
}

export function subscribeValuePreviewDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listValuePreviewDialogs(): ValuePreviewWindowState[] {
  return openWindows;
}

export function closeValuePreviewDialog(id: string): void {
  const before = openWindows.length;
  openWindows = openWindows.filter((item) => item.id !== id);
  if (openWindows.length === before) {
    return;
  }
  if (focusedWindowId === id) {
    focusedWindowId = openWindows.length > 0
      ? [...openWindows].sort((a, b) => b.zIndex - a.zIndex)[0].id
      : null;
  }
  emitChanged();
}

export function focusValuePreviewDialog(id: string): void {
  let changed = false;
  openWindows = openWindows.map((item) => {
    if (item.id !== id) {
      return item;
    }
    changed = true;
    focusedWindowId = id;
    return { ...item, zIndex: nextZ++, minimized: false };
  });
  if (!changed) {
    return;
  }
  emitChanged();
}

export function moveValuePreviewDialog(id: string, x: number, y: number): void {
  updateValuePreviewDialog(id, { x, y });
}

export function resizeValuePreviewDialog(id: string, width: number, height: number): void {
  updateValuePreviewDialog(id, {
    width: Math.max(320, Math.round(width)),
    height: Math.max(220, Math.round(height)),
  });
}

export function minimizeValuePreviewDialog(id: string): void {
  if (focusedWindowId === id) {
    focusedWindowId = null;
  }
  updateValuePreviewDialog(id, { minimized: true });
}

export function restoreValuePreviewDialog(id: string): void {
  focusedWindowId = id;
  updateValuePreviewDialog(id, { minimized: false, zIndex: nextZ++ });
}

export function closeFocusedValuePreviewDialog(): boolean {
  if (!focusedWindowId) {
    return false;
  }
  const id = focusedWindowId;
  closeValuePreviewDialog(id);
  return true;
}

function updateValuePreviewDialog(id: string, patch: Partial<ValuePreviewWindowState>): void {
  let changed = false;
  openWindows = openWindows.map((item) => {
    if (item.id !== id) {
      return item;
    }
    changed = true;
    return { ...item, ...patch };
  });
  if (!changed) {
    return;
  }
  emitChanged();
}

function emitChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
