export type ActiveFlowCommandHandlers = {
  runNode: (nodeId?: string) => void | Promise<void>;
  runToNode: (nodeId?: string) => void | Promise<void>;
  configureNode: (nodeId?: string) => void | Promise<void>;
};

let activeHandlers: ActiveFlowCommandHandlers | undefined;

export function setActiveFlowCommandHandlers(handlers: ActiveFlowCommandHandlers): () => void {
  activeHandlers = handlers;
  return () => {
    if (activeHandlers === handlers) {
      activeHandlers = undefined;
    }
  };
}

export function runActiveFlowNode(nodeId?: string): void {
  void activeHandlers?.runNode(nodeId);
}

export function runActiveFlowToNode(nodeId?: string): void {
  void activeHandlers?.runToNode(nodeId);
}

export function configureActiveFlowNode(nodeId?: string): void {
  void activeHandlers?.configureNode(nodeId);
}

export function hasActiveFlowCommandHandlers(): boolean {
  return activeHandlers !== undefined;
}
