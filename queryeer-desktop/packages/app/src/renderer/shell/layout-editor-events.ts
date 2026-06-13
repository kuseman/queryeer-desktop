const SPLIT_ACTIVE_EDITOR_RIGHT_EVENT = "shell:splitActiveEditorRight";
const OPEN_EDITOR_TO_SIDE_EVENT = "shell:openEditorToSide";
const CLOSE_ACTIVE_EDITOR_EVENT = "shell:closeActiveEditor";

export type OpenEditorToSideRequest = {
  fileId: string;
  removeFromOtherGroups?: boolean;
};

export function requestSplitActiveEditorRight(): void {
  window.dispatchEvent(new CustomEvent(SPLIT_ACTIVE_EDITOR_RIGHT_EVENT));
}

export function subscribeSplitActiveEditorRightRequests(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(SPLIT_ACTIVE_EDITOR_RIGHT_EVENT, handler);
  return () => window.removeEventListener(SPLIT_ACTIVE_EDITOR_RIGHT_EVENT, handler);
}

export function requestOpenEditorToSide(request: OpenEditorToSideRequest): void {
  window.dispatchEvent(
    new CustomEvent<OpenEditorToSideRequest>(OPEN_EDITOR_TO_SIDE_EVENT, { detail: request })
  );
}

export function subscribeOpenEditorToSideRequests(
  listener: (request: OpenEditorToSideRequest) => void
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<OpenEditorToSideRequest>;
    listener(custom.detail);
  };
  window.addEventListener(OPEN_EDITOR_TO_SIDE_EVENT, handler);
  return () => window.removeEventListener(OPEN_EDITOR_TO_SIDE_EVENT, handler);
}

export function requestCloseActiveEditor(): void {
  window.dispatchEvent(new CustomEvent(CLOSE_ACTIVE_EDITOR_EVENT));
}

export function subscribeCloseActiveEditorRequests(listener: () => void): () => void {
  const handler = () => listener();
  window.addEventListener(CLOSE_ACTIVE_EDITOR_EVENT, handler);
  return () => window.removeEventListener(CLOSE_ACTIVE_EDITOR_EVENT, handler);
}
