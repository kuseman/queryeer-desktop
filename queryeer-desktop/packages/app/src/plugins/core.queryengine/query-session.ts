const QUERY_ENGINE_SESSION_PREFIX = "core.queryengine:";

export function toQueryOutputSessionId(editorGroupId: string | undefined, fallbackId: string | undefined = "default"): string {
  return editorGroupId
    ? `${QUERY_ENGINE_SESSION_PREFIX}${editorGroupId}`
    : (fallbackId ?? "default");
}

export function querySessionKey(outputSessionId: string): string {
  return outputSessionId.startsWith(QUERY_ENGINE_SESSION_PREFIX)
    ? outputSessionId.slice(QUERY_ENGINE_SESSION_PREFIX.length)
    : outputSessionId;
}
