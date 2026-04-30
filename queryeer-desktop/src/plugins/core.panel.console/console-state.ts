type Listener = () => void;

type ConsoleNotificationState = {
  unseenErrorCount: number;
};

const state: ConsoleNotificationState = {
  unseenErrorCount: 0
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeConsoleNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConsoleNotificationState(): ConsoleNotificationState {
  return { ...state };
}

export function notifyConsoleErrorAppended(): void {
  state.unseenErrorCount += 1;
  emit();
}

export function resetConsoleNotifications(): void {
  if (state.unseenErrorCount === 0) {
    return;
  }
  state.unseenErrorCount = 0;
  emit();
}
