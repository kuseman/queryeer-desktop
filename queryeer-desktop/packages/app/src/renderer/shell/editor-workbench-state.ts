import {
  recordTabActivation,
  resolveNextActiveTab,
  resolveOpenFileIds
} from "./tab-activation-queue";
import type {
  PersistedEditorGroup,
  PersistedEditorLayoutNode,
  PersistedLayoutSnapshot
} from "@queryeer/api/workspace/WorkspaceSnapshot";

export type EditorGroupState = {
  id: string;
  fileIds: string[];
  activeFileId: string | null;
  activationQueue: string[];
};

export type EditorWorkbenchState = {
  groups: EditorGroupState[];
  activeGroupId: string;
  sizes: number[];
};

type FileDescriptor = {
  fileId: string;
  uri: string;
};

type RestoredEditorGroup = EditorGroupState;

export function createEditorWorkbenchState(
  fileIds: string[],
  activeFileId: string | null
): EditorWorkbenchState {
  const resolvedActiveFileId = activeFileId && fileIds.includes(activeFileId)
    ? activeFileId
    : fileIds[fileIds.length - 1] ?? null;
  const group: EditorGroupState = {
    id: "editor-group-1",
    fileIds: [...fileIds],
    activeFileId: resolvedActiveFileId,
    activationQueue: resolvedActiveFileId ? [resolvedActiveFileId] : []
  };
  return {
    groups: [group],
    activeGroupId: group.id,
    sizes: [1]
  };
}

export function normalizeEditorWorkbenchState(state: EditorWorkbenchState): EditorWorkbenchState {
  const groups = state.groups.length > 0 ? state.groups : createEditorWorkbenchState([], null).groups;
  const activeGroupId = groups.some((group) => group.id === state.activeGroupId)
    ? state.activeGroupId
    : groups[0].id;
  return {
    groups: groups.map(normalizeGroup),
    activeGroupId,
    sizes: normalizeSizes(state.sizes, groups.length)
  };
}

export function restoreEditorWorkbenchStateFromSnapshot(
  files: FileDescriptor[],
  restoredLayout: PersistedLayoutSnapshot | null | undefined,
  restoredActiveFileId: string | null
): EditorWorkbenchState {
  const fallback = createEditorWorkbenchState(files.map((file) => file.fileId), restoredActiveFileId);
  const restoredGroups = restoredLayout?.editorGroups;
  if (!restoredGroups || restoredGroups.length === 0) {
    return fallback;
  }

  const fileByUri = new Map(files.map((file) => [file.uri, file]));
  const groups = restoredGroups
    .map((group) => restoreEditorGroup(group, fileByUri))
    .filter((group): group is RestoredEditorGroup => Boolean(group));

  if (groups.length === 0) {
    return fallback;
  }

  const orderedGroups = orderGroupsByPersistedLayout(groups, restoredLayout?.editorLayout);
  const activeGroupId = resolveRestoredActiveGroupId(orderedGroups, restoredLayout);
  return normalizeEditorWorkbenchState({
    groups: orderedGroups,
    activeGroupId,
    sizes: resolvePersistedEditorLayoutSizes(
      restoredLayout?.editorLayout,
      orderedGroups.map((group) => group.id)
    )
  });
}

export function createPersistedEditorLayout(state: EditorWorkbenchState): PersistedEditorLayoutNode {
  const leaves = state.groups.map((group) => ({
    kind: "leaf" as const,
    groupId: group.id
  }));
  if (leaves.length <= 1) {
    return leaves[0] ?? { kind: "split", direction: "horizontal", children: [], sizes: [] };
  }
  return {
    kind: "split",
    direction: "horizontal",
    children: leaves,
    sizes: normalizeSizes(state.sizes, leaves.length)
  };
}

export function getPersistedEditorLayoutGroupIds(layout: PersistedEditorLayoutNode | undefined): string[] {
  if (!layout) {
    return [];
  }
  if (layout.kind === "leaf") {
    return [layout.groupId];
  }
  return layout.children.flatMap((child) => getPersistedEditorLayoutGroupIds(child));
}

export function resolvePersistedEditorLayoutSizes(
  layout: PersistedEditorLayoutNode | undefined,
  groupIds: string[]
): number[] {
  if (
    layout?.kind === "split" &&
    layout.direction === "horizontal" &&
    layout.children.length === groupIds.length &&
    layout.children.every((child, index) => child.kind === "leaf" && child.groupId === groupIds[index])
  ) {
    return normalizeSizes(layout.sizes ?? [], groupIds.length);
  }
  if (layout?.kind === "leaf" && groupIds.length === 1 && layout.groupId === groupIds[0]) {
    return [1];
  }
  return normalizeSizes([], groupIds.length);
}

export function getActiveEditorGroup(state: EditorWorkbenchState): EditorGroupState {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0];
}

export function getActiveWorkbenchFileId(state: EditorWorkbenchState): string | null {
  return getActiveEditorGroup(state).activeFileId;
}

export function focusEditorGroup(state: EditorWorkbenchState, groupId: string): EditorWorkbenchState {
  if (!state.groups.some((group) => group.id === groupId)) {
    return state;
  }
  return { ...state, activeGroupId: groupId };
}

export function selectFileInGroup(
  state: EditorWorkbenchState,
  groupId: string,
  fileId: string
): EditorWorkbenchState {
  return mapGroup(state, groupId, (group) => {
    if (!group.fileIds.includes(fileId)) {
      return group;
    }
    return activateFile(group, fileId);
  }, { activeGroupId: groupId });
}

export function openFileInGroup(
  state: EditorWorkbenchState,
  groupId: string,
  fileId: string
): EditorWorkbenchState {
  return mapGroup(state, groupId, (group) => {
    const fileIds = group.fileIds.includes(fileId)
      ? group.fileIds
      : [...group.fileIds, fileId];
    return activateFile({ ...group, fileIds }, fileId);
  }, { activeGroupId: groupId });
}

export function openFileInActiveGroup(state: EditorWorkbenchState, fileId: string): EditorWorkbenchState {
  return openFileInGroup(state, state.activeGroupId, fileId);
}

export function splitActiveGroupRight(state: EditorWorkbenchState): EditorWorkbenchState {
  const activeGroup = getActiveEditorGroup(state);
  const activeFileId = activeGroup.activeFileId;
  if (!activeFileId) {
    return state;
  }
  const activeIndex = state.groups.findIndex((group) => group.id === activeGroup.id);
  const newGroup: EditorGroupState = {
    id: nextGroupId(state.groups),
    fileIds: [activeFileId],
    activeFileId,
    activationQueue: [activeFileId]
  };
  const groups = [
    ...state.groups.slice(0, activeIndex + 1),
    newGroup,
    ...state.groups.slice(activeIndex + 1)
  ];
  return {
    groups,
    activeGroupId: newGroup.id,
    sizes: normalizeSizes([], groups.length)
  };
}

export function openFileToSide(
  state: EditorWorkbenchState,
  fileId: string,
  options: { removeFromOtherGroups?: boolean } = {}
): EditorWorkbenchState {
  const activeIndex = Math.max(0, state.groups.findIndex((group) => group.id === state.activeGroupId));
  const existingTarget = state.groups[activeIndex + 1];
  const targetGroup = existingTarget ?? {
    id: nextGroupId(state.groups),
    fileIds: [],
    activeFileId: null,
    activationQueue: []
  } satisfies EditorGroupState;

  let groups = existingTarget
    ? [...state.groups]
    : [
        ...state.groups.slice(0, activeIndex + 1),
        targetGroup,
        ...state.groups.slice(activeIndex + 1)
      ];

  if (options.removeFromOtherGroups) {
    groups = groups.map((group) => group.id === targetGroup.id
      ? group
      : removeFileFromGroup(group, fileId)
    );
  }

  groups = groups.map((group) => group.id === targetGroup.id
    ? activateFile(
        {
          ...group,
          fileIds: group.fileIds.includes(fileId) ? group.fileIds : [...group.fileIds, fileId]
        },
        fileId
      )
    : group
  );

  const collapsed = collapseEmptyGroups(groups, targetGroup.id);
  return {
    groups: collapsed,
    activeGroupId: targetGroup.id,
    sizes: normalizeSizes([], collapsed.length)
  };
}

export function resizeAdjacentEditorGroups(
  state: EditorWorkbenchState,
  dividerIndex: number,
  deltaRatio: number,
  minimumGroupSizeRatio = 0
): EditorWorkbenchState {
  if (dividerIndex < 0 || dividerIndex >= state.groups.length - 1) {
    return state;
  }
  const sizes = normalizeSizes(state.sizes, state.groups.length);
  const leftStart = sizes[dividerIndex] ?? 0;
  const rightStart = sizes[dividerIndex + 1] ?? 0;
  const pairTotal = leftStart + rightStart;
  const minimum = Math.min(Math.max(0, minimumGroupSizeRatio), pairTotal / 2);
  const nextLeft = Math.min(pairTotal - minimum, Math.max(minimum, leftStart + deltaRatio));
  const nextSizes = [...sizes];
  nextSizes[dividerIndex] = nextLeft;
  nextSizes[dividerIndex + 1] = pairTotal - nextLeft;
  return {
    ...state,
    sizes: normalizeSizes(nextSizes, state.groups.length)
  };
}

export function closeFileInGroup(
  state: EditorWorkbenchState,
  groupId: string,
  fileId: string
): EditorWorkbenchState {
  const groupIndex = state.groups.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return state;
  }
  const groups = state.groups.map((group) => group.id === groupId
    ? removeFileFromGroup(group, fileId)
    : group
  );
  const activeFallbackId = state.groups[groupIndex + 1]?.id
    ?? state.groups[groupIndex - 1]?.id
    ?? groupId;
  const collapsed = collapseEmptyGroups(groups, activeFallbackId);
  const activeGroupId = collapsed.some((group) => group.id === state.activeGroupId)
    ? state.activeGroupId
    : activeFallbackId;
  return normalizeEditorWorkbenchState({
    groups: collapsed,
    activeGroupId,
    sizes: normalizeSizes([], collapsed.length)
  });
}

export function syncWorkbenchWithFiles(
  state: EditorWorkbenchState,
  nextFiles: FileDescriptor[],
  options: { openNewFilesLast: boolean }
): { state: EditorWorkbenchState; addedFileIds: string[] } {
  const nextIds = new Set(nextFiles.map((file) => file.fileId));
  const knownIds = new Set(state.groups.flatMap((group) => group.fileIds));
  const addedFileIds = nextFiles
    .filter((file) => !knownIds.has(file.fileId))
    .map((file) => file.fileId);

  let groups = state.groups.map((group) => {
    const retained = group.fileIds.filter((fileId) => nextIds.has(fileId));
    const queue = group.activationQueue.filter((fileId) => retained.includes(fileId));
    const activeFileId = group.activeFileId && retained.includes(group.activeFileId)
      ? group.activeFileId
      : resolveNextActiveTab({
          queue,
          openFileIds: retained,
          excludeFileId: group.activeFileId ?? undefined,
          previousOpenFileIds: group.fileIds
        }).nextActiveFileId;
    return {
      ...group,
      fileIds: retained,
      activeFileId,
      activationQueue: activeFileId ? recordTabActivation(queue, activeFileId) : queue
    };
  });

  if (addedFileIds.length > 0) {
    const activeGroup = state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0];
    const activeGroupIndex = groups.findIndex((group) => group.id === activeGroup.id);
    const nextActiveGroup = groups[activeGroupIndex] ?? groups[0];
    const nextFilesForGroup = [
      ...nextActiveGroup.fileIds
        .map((fileId) => nextFiles.find((file) => file.fileId === fileId))
        .filter((file): file is FileDescriptor => Boolean(file)),
      ...nextFiles.filter((file) => addedFileIds.includes(file.fileId))
    ];
    const resolution = resolveOpenFileIds({
      previousOpenFileIds: nextActiveGroup.fileIds,
      nextFiles: nextFilesForGroup,
      openNewFilesLast: options.openNewFilesLast,
      activeFileId: activeGroup.activeFileId,
      activationQueue: activeGroup.activationQueue
    });
    const activeFileId = addedFileIds[addedFileIds.length - 1] ?? nextActiveGroup.activeFileId;
    groups = groups.map((group) => group.id === nextActiveGroup.id
      ? {
          ...group,
          fileIds: resolution.nextOpenFileIds,
          activeFileId,
          activationQueue: activeFileId
            ? recordTabActivation(group.activationQueue, activeFileId)
            : group.activationQueue
        }
      : group
    );
  }

  const collapsed = collapseEmptyGroups(groups, state.activeGroupId);
  return {
    state: normalizeEditorWorkbenchState({
      groups: collapsed,
      activeGroupId: collapsed.some((group) => group.id === state.activeGroupId)
        ? state.activeGroupId
        : collapsed[0].id,
      sizes: normalizeSizes(state.sizes, collapsed.length)
    }),
    addedFileIds
  };
}

export function isFileReferenced(state: EditorWorkbenchState, fileId: string): boolean {
  return state.groups.some((group) => group.fileIds.includes(fileId));
}

export function listWorkbenchFileIds(state: EditorWorkbenchState): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of state.groups) {
    for (const fileId of group.fileIds) {
      if (!seen.has(fileId)) {
        seen.add(fileId);
        result.push(fileId);
      }
    }
  }
  return result;
}

function restoreEditorGroup(
  group: PersistedEditorGroup,
  fileByUri: Map<string, FileDescriptor>
): RestoredEditorGroup | null {
  const fileIds = group.fileUris
    .map((uri) => fileByUri.get(uri)?.fileId)
    .filter((fileId): fileId is string => Boolean(fileId));
  if (fileIds.length === 0) {
    return null;
  }
  const activeFileId = group.activeFileUri
    ? fileByUri.get(group.activeFileUri)?.fileId ?? null
    : null;
  return {
    id: group.id,
    fileIds,
    activeFileId: activeFileId && fileIds.includes(activeFileId)
      ? activeFileId
      : fileIds[fileIds.length - 1] ?? null,
    activationQueue: []
  };
}

function orderGroupsByPersistedLayout(
  groups: RestoredEditorGroup[],
  layout: PersistedEditorLayoutNode | undefined
): RestoredEditorGroup[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  const ordered: RestoredEditorGroup[] = [];
  for (const groupId of getPersistedEditorLayoutGroupIds(layout)) {
    const group = groupsById.get(groupId);
    if (!group || seen.has(group.id)) {
      continue;
    }
    ordered.push(group);
    seen.add(group.id);
  }
  if (ordered.length === 0) {
    return groups;
  }
  return [
    ...ordered,
    ...groups.filter((group) => !seen.has(group.id))
  ];
}

function resolveRestoredActiveGroupId(
  groups: RestoredEditorGroup[],
  restoredLayout: PersistedLayoutSnapshot | null | undefined
): string {
  const activeEditorGroupId = restoredLayout?.activeEditorGroupId;
  if (activeEditorGroupId && groups.some((group) => group.id === activeEditorGroupId)) {
    return activeEditorGroupId;
  }
  return groups[0].id;
}

function mapGroup(
  state: EditorWorkbenchState,
  groupId: string,
  map: (group: EditorGroupState) => EditorGroupState,
  options: { activeGroupId?: string } = {}
): EditorWorkbenchState {
  if (!state.groups.some((group) => group.id === groupId)) {
    return state;
  }
  return normalizeEditorWorkbenchState({
    ...state,
    activeGroupId: options.activeGroupId ?? state.activeGroupId,
    groups: state.groups.map((group) => group.id === groupId ? normalizeGroup(map(group)) : group)
  });
}

function activateFile(group: EditorGroupState, fileId: string): EditorGroupState {
  return {
    ...group,
    activeFileId: fileId,
    activationQueue: recordTabActivation(group.activationQueue, fileId)
  };
}

function removeFileFromGroup(group: EditorGroupState, fileId: string): EditorGroupState {
  if (!group.fileIds.includes(fileId)) {
    return group;
  }
  const fileIds = group.fileIds.filter((id) => id !== fileId);
  const resolution = resolveNextActiveTab({
    queue: group.activationQueue,
    openFileIds: fileIds,
    excludeFileId: fileId,
    previousOpenFileIds: group.fileIds
  });
  return {
    ...group,
    fileIds,
    activeFileId: resolution.nextActiveFileId,
    activationQueue: resolution.nextQueue
  };
}

function collapseEmptyGroups(groups: EditorGroupState[], preferredActiveGroupId: string): EditorGroupState[] {
  if (groups.length <= 1) {
    return groups.length === 1 ? groups : createEditorWorkbenchState([], null).groups;
  }
  const nonEmpty = groups.filter((group) => group.fileIds.length > 0 || group.id === preferredActiveGroupId);
  if (nonEmpty.length === 0) {
    return [groups[0]];
  }
  if (nonEmpty.length === 1 && nonEmpty[0].fileIds.length === 0 && groups.some((group) => group.fileIds.length > 0)) {
    return groups.filter((group) => group.fileIds.length > 0);
  }
  return nonEmpty;
}

function normalizeGroup(group: EditorGroupState): EditorGroupState {
  const fileIds = [...new Set(group.fileIds)];
  const activeFileId = group.activeFileId && fileIds.includes(group.activeFileId)
    ? group.activeFileId
    : fileIds[fileIds.length - 1] ?? null;
  const activationQueue = group.activationQueue.filter((fileId, index, queue) =>
    fileIds.includes(fileId) && queue.lastIndexOf(fileId) === index
  );
  return {
    ...group,
    fileIds,
    activeFileId,
    activationQueue: activeFileId ? recordTabActivation(activationQueue, activeFileId) : activationQueue
  };
}

function normalizeSizes(sizes: number[], groupCount: number): number[] {
  if (groupCount <= 0) {
    return [];
  }
  if (sizes.length === groupCount && sizes.every((size) => Number.isFinite(size) && size > 0)) {
    const total = sizes.reduce((sum, size) => sum + size, 0);
    return sizes.map((size) => size / total);
  }
  return Array.from({ length: groupCount }, () => 1 / groupCount);
}

function nextGroupId(groups: EditorGroupState[]): string {
  let max = 0;
  for (const group of groups) {
    const match = /^editor-group-(\d+)$/.exec(group.id);
    if (!match) {
      continue;
    }
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `editor-group-${max + 1}`;
}
