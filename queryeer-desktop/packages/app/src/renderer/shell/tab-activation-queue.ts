export function recordTabActivation(queue: string[], fileId: string | null): string[] {
  if (!fileId) {
    return queue;
  }
  const withoutFile = queue.filter((id) => id !== fileId);
  return [...withoutFile, fileId];
}

type OpenFileDescriptor = {
  fileId: string;
  uri: string;
};

export function resolveOpenFileIds(params: {
  previousOpenFileIds: string[];
  nextFiles: OpenFileDescriptor[];
  openNewFilesLast: boolean;
  activeFileId: string | null;
  activationQueue: string[];
}): { nextOpenFileIds: string[]; addedFileIds: string[] } {
  const nextIds = new Set(params.nextFiles.map((file) => file.fileId));
  const retained = params.previousOpenFileIds.filter((id) => nextIds.has(id));
  const added = params.nextFiles
    .filter((file) => !params.previousOpenFileIds.includes(file.fileId))
    .map((file) => file.fileId);

  if (added.length === 0) {
    return { nextOpenFileIds: retained, addedFileIds: added };
  }

  if (params.openNewFilesLast) {
    return { nextOpenFileIds: [...retained, ...added], addedFileIds: added };
  }

  const ordered = [...retained];

  const activeIndex = params.activeFileId ? ordered.indexOf(params.activeFileId) : -1;
  if (activeIndex >= 0) {
    ordered.splice(activeIndex + 1, 0, ...added);
    return { nextOpenFileIds: ordered, addedFileIds: added };
  }

  const anchorId = [...params.activationQueue].reverse().find((queuedId) => ordered.includes(queuedId));
  const anchorIndex = anchorId ? ordered.indexOf(anchorId) : -1;
  if (anchorIndex >= 0) {
    ordered.splice(anchorIndex + 1, 0, ...added);
    return { nextOpenFileIds: ordered, addedFileIds: added };
  }

  return { nextOpenFileIds: [...ordered, ...added], addedFileIds: added };
}

export function resolveActiveFileAfterRegistryUpdate(params: {
  previousActiveFileId: string | null;
  nextOpenFileIds: string[];
  addedFileIds: string[];
  activationQueue: string[];
  previousOpenFileIds?: string[];
}): { nextActiveFileId: string | null; nextQueue: string[] } {
  if (params.addedFileIds.length > 0) {
    return {
      nextActiveFileId: params.addedFileIds[params.addedFileIds.length - 1] ?? null,
      nextQueue: params.activationQueue
    };
  }

  if (params.previousActiveFileId && !params.nextOpenFileIds.includes(params.previousActiveFileId)) {
    return resolveNextActiveTab({
      queue: params.activationQueue,
      openFileIds: params.nextOpenFileIds,
      excludeFileId: params.previousActiveFileId,
      previousOpenFileIds: params.previousOpenFileIds
    });
  }

  if (params.previousActiveFileId && params.nextOpenFileIds.includes(params.previousActiveFileId)) {
    return {
      nextActiveFileId: params.previousActiveFileId,
      nextQueue: params.activationQueue
    };
  }

  return {
    nextActiveFileId:
      params.nextOpenFileIds.length > 0 ? params.nextOpenFileIds[params.nextOpenFileIds.length - 1] ?? null : null,
    nextQueue: params.activationQueue
  };
}

export function resolveNextActiveTab(params: {
  queue: string[];
  openFileIds: string[];
  excludeFileId?: string;
  previousOpenFileIds?: string[];
}): { nextActiveFileId: string | null; nextQueue: string[] } {
  const openSet = new Set(params.openFileIds);
  const nextQueue = params.queue.filter((id) => {
    if (params.excludeFileId && id === params.excludeFileId) {
      return false;
    }
    return openSet.has(id);
  });

  for (let index = nextQueue.length - 1; index >= 0; index -= 1) {
    const candidate = nextQueue[index];
    if (candidate && openSet.has(candidate)) {
      return { nextActiveFileId: candidate, nextQueue };
    }
  }

  if (params.openFileIds.length === 0) {
    return { nextActiveFileId: null, nextQueue };
  }

  if (params.previousOpenFileIds && params.excludeFileId) {
    const closedIndex = params.previousOpenFileIds.indexOf(params.excludeFileId);
    if (closedIndex >= 0) {
      const rightNeighbor = params.previousOpenFileIds[closedIndex + 1];
      if (rightNeighbor && openSet.has(rightNeighbor)) {
        return { nextActiveFileId: rightNeighbor, nextQueue };
      }
      const leftNeighbor = params.previousOpenFileIds[closedIndex - 1];
      if (leftNeighbor && openSet.has(leftNeighbor)) {
        return { nextActiveFileId: leftNeighbor, nextQueue };
      }
    }
  }

  return {
    nextActiveFileId: params.openFileIds[params.openFileIds.length - 1] ?? null,
    nextQueue
  };
}
