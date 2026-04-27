type DialogSeverity = "info" | "warning" | "error";

type MessageDialogOptions = {
  title: string;
  message: string;
  severity?: DialogSeverity;
  detail?: string;
  options?: { label: string; value: string }[];
};

type MessageDialogResult = {
  action: string;
};

type MessageDialogRequest = {
  options: MessageDialogOptions;
  resolve: (result: MessageDialogResult) => void;
};

type Listener = () => void;

const queue: MessageDialogRequest[] = [];
let active: MessageDialogRequest | null = null;
const listeners = new Set<Listener>();

export function requestMessageDialog(options: MessageDialogOptions): Promise<MessageDialogResult> {
  return new Promise((resolve) => {
    queue.push({ options, resolve });
    activateNextIfIdle();
    emitChanged();
  });
}

export function subscribeMessageDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveMessageDialogRequest(): MessageDialogRequest | null {
  return active;
}

export function resolveActiveMessageDialog(result: MessageDialogResult): void {
  if (!active) {
    return;
  }

  const current = active;
  active = null;
  current.resolve(result);
  activateNextIfIdle();
  emitChanged();
}

function activateNextIfIdle(): void {
  if (active || queue.length === 0) {
    return;
  }

  active = queue.shift() ?? null;
}

function emitChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
