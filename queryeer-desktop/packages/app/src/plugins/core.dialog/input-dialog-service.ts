type InputDialogOptions = {
  title: string;
  message: string;
  placeholder?: string;
  password?: boolean;
};

type InputDialogResult = {
  canceled: boolean;
  value?: string;
};

type InputDialogRequest = {
  options: InputDialogOptions;
  resolve: (result: InputDialogResult) => void;
};

type Listener = () => void;

const queue: InputDialogRequest[] = [];
let active: InputDialogRequest | null = null;
const listeners = new Set<Listener>();

export function requestInputDialog(options: InputDialogOptions): Promise<InputDialogResult> {
  return new Promise((resolve) => {
    queue.push({ options, resolve });
    activateNextIfIdle();
    emitChanged();
  });
}

export function subscribeInputDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveInputDialogRequest(): InputDialogRequest | null {
  return active;
}

export function resolveActiveInputDialog(result: InputDialogResult): void {
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
