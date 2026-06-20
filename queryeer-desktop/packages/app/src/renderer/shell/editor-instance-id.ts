export function createEditorInstanceId(groupId: string, editorId?: string): string {
  return `${groupId}:${editorId ?? "no-editor"}`;
}
