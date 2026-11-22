/** Options for {@link PluginBackend.invoke}. */
export type PluginBackendInvokeOptions = {
  /** Don't ask the user to unlock a locked vault; reject instead, unless it can be unlocked without asking. */
  silent?: boolean;
  /** How long to wait for the backend's answer, in milliseconds. Default 10 000. The backend action is not cancelled when it runs out. */
  timeoutMs?: number;
};

/**
 * What {@link PluginBackend.invoke} rejects with: an `Error` with the backend's message and its error code, e.g.
 * `VALIDATION` (the handler threw `IllegalArgumentException`), `ACTION_NOT_FOUND` (no such action, e.g. an older
 * plugin backend), `INTERNAL`, or `TIMEOUT`.
 */
export type PluginBackendError = Error & { code?: string };

/**
 * The plugin's own backend: actions its backend registered with `context.actions().register(action, handler)`
 * (`PluginActionRegistry`). For a plugin's views, settings and dialogs that need its backend without a query engine.
 * The frontend and backend must share a plugin id, as an external plugin's `plugin.json` gives both. Since 0.23.0:
 * a plugin whose `apiVersion` also allows older Queryeer versions checks that `context.backend` exists.
 */
export type PluginBackend = {
  /**
   * Calls the backend action `action` of this plugin with `payload` and resolves to what the handler returns
   * (`undefined` for `null`). Secret references in the payload (`{ secretRef }`) reach the handler as they are; the
   * handler resolves them with `ConfigService.materializeSecrets`, and when the vault is locked this asks the user to
   * unlock it and calls again (not with `silent`). Rejects with a {@link PluginBackendError} when the handler throws,
   * the action doesn't exist, the call times out, or the backend isn't running yet (`BackendNotReadyError`, without
   * waiting for it to start).
   */
  invoke: <TResult = unknown>(action: string, payload?: unknown, options?: PluginBackendInvokeOptions) => Promise<TResult>;
};
