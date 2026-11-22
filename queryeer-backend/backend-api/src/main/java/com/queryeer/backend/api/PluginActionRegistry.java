package com.queryeer.backend.api;

/**
 * Backend actions of one plugin, which that plugin's frontend calls with {@code context.backend.invoke(action, payload)}: for a plugin's own views, settings and dialogs, without a query engine.
 * Actions are scoped to the plugin that registers them, so names need no plugin prefix, and {@code context.backend} calls only its own plugin's actions. That scoping is a convention between plugins,
 * not a security boundary: code in the frontend could address another plugin's actions directly, as it can address any query engine. Reached through {@link BackendPluginContext#actions()}.
 *
 * <p>
 * The frontend and the backend reach the same actions only when they share a plugin id, as an external plugin's {@code plugin.json} gives both.
 * </p>
 *
 * @since 0.23.0
 */
public interface PluginActionRegistry
{
    /**
     * Registers {@code handler} for {@code action}, replacing an earlier handler of the same name. The actions are removed when the plugin deactivates or fails to activate; registering after that
     * throws {@link IllegalStateException}.
     *
     * <p>
     * The payload arrives as the frontend sent it, as plain JSON values: maps, lists, strings, numbers, booleans and nulls. Secret references in it ({@code { "secretRef": ... }}) are not resolved:
     * pass them to {@link ConfigService#materializeSecrets(Object)}, which asks the frontend to unlock a locked vault and retry. The returned value is sent back as JSON. An
     * {@link IllegalArgumentException} is reported to the frontend as a validation error with its message; other exceptions as internal errors.
     * </p>
     */
    void register(String action, PluginActionHandler handler);
}
