type QuitEvent = {
  preventDefault: () => void;
};

type ShutdownDependencies = {
  stopBackend: () => Promise<void>;
  flushWorkspace: () => Promise<void>;
  requestQuit: () => void;
};

export function createBeforeQuitHandler(deps: ShutdownDependencies): (event: QuitEvent) => void {
  let isQuitting = false;
  let shutdownPromise: Promise<void> | null = null;

  const shutdownMainServices = async (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      try {
        await deps.stopBackend();
      } catch {
        // Ignore backend stop failures during app shutdown.
      }

      try {
        await deps.flushWorkspace();
      } catch {
        // Ignore workspace flush failures during app shutdown.
      }
    })();

    return shutdownPromise;
  };

  return (event: QuitEvent) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    isQuitting = true;
    void shutdownMainServices().finally(() => {
      deps.requestQuit();
    });
  };
}
