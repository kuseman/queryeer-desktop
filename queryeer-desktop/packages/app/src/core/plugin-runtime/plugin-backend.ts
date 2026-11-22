import { BackendNotReadyError } from "@queryeer/api/backend/BackendNotReadyError";
import type { PluginBackend, PluginBackendError, PluginBackendInvokeOptions } from "@queryeer/api/plugin/PluginBackend";
import { getCoreSecurityService } from "../../plugins/core.security/service";

/** `context.backend` for one plugin: its calls reach only that plugin's backend actions (`plugin.invoke`). */
export function createPluginBackend(pluginId: string): PluginBackend {
  return {
    invoke: async <TResult>(action: string, payload?: unknown, options?: PluginBackendInvokeOptions): Promise<TResult> => {
      const status = await window.appShell.getBackendStatus();
      if (status.state !== "healthy") {
        throw new BackendNotReadyError();
      }
      const call = async () => {
        const response = await window.appShell.invokeBackendPlugin(
          { pluginId, action, ...(payload !== undefined ? { payload } : {}) },
          options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined
        );
        if (response.error?.code === "SECURITY_SESSION_CLOSED") {
          // withVaultRetry asks to unlock the vault and calls again
          throw new Error(`SECURITY_SESSION_CLOSED: ${response.error.message}`);
        }
        return response;
      };
      const security = getCoreSecurityService();
      const response = security ? await security.withVaultRetry(call, { interactive: !options?.silent }) : await call();
      if (response.error) {
        const error: PluginBackendError = new Error(response.error.message);
        error.code = response.error.code;
        throw error;
      }
      return (response.result ?? undefined) as TResult;
    }
  };
}
