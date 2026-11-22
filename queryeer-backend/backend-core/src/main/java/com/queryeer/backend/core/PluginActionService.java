package com.queryeer.backend.core;

import static java.util.Objects.requireNonNull;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.PluginActionHandler;
import com.queryeer.backend.api.PluginActionRegistry;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.core.security.SecretRefPayloadResolver;

/** The backend actions of every plugin ({@link PluginActionRegistry}), by plugin id and action, and the {@code plugin.invoke} requests that call them. */
public final class PluginActionService
{
    private final Map<String, Map<String, PluginActionHandler>> handlersByPlugin = new ConcurrentHashMap<>();
    /** Plugins that deactivated or failed to activate: their registries refuse later registrations. */
    private final Set<String> closedPlugins = ConcurrentHashMap.newKeySet();

    /** The registry a plugin's context hands out: it registers under that plugin's id only. */
    public PluginActionRegistry forPlugin(String pluginId)
    {
        requireNonNull(pluginId, "pluginId");
        return (action, handler) ->
        {
            if (action == null
                    || action.isBlank())
            {
                throw new IllegalArgumentException("A backend action needs a name");
            }
            requireNonNull(handler, "handler");
            // Checked again after adding, so a registration racing the plugin's removal never stays
            if (!closedPlugins.contains(pluginId))
            {
                handlersByPlugin.computeIfAbsent(pluginId, _ -> new ConcurrentHashMap<>())
                        .put(action, handler);
            }
            if (closedPlugins.contains(pluginId))
            {
                handlersByPlugin.remove(pluginId);
                throw new IllegalStateException("Plugin '" + pluginId + "' is no longer active: its backend actions can't be registered");
            }
        };
    }

    /** Drops a plugin's actions, when it deactivates or fails to activate; its registry refuses registrations from then on. */
    void removePlugin(String pluginId)
    {
        closedPlugins.add(pluginId);
        handlersByPlugin.remove(pluginId);
    }

    public Object invoke(String pluginId, String action, Object payload)
    {
        if (action == null
                || action.isBlank())
        {
            throw new PluginActionException(BackendErrorCode.VALIDATION, "A backend action needs a name", null);
        }
        PluginActionHandler handler = pluginId == null ? null
                : handlersByPlugin.getOrDefault(pluginId, Map.of())
                        .get(action);
        if (handler == null)
        {
            throw new PluginActionException(BackendErrorCode.ACTION_NOT_FOUND, "Plugin '" + pluginId + "' has no backend action '" + action + "'", null);
        }
        try
        {
            return handler.invoke(payload);
        }
        catch (SecuritySessionClosedException e)
        {
            throw new PluginActionException(BackendErrorCode.SECURITY_SESSION_CLOSED, e.getMessage(), null);
        }
        catch (SecretRefPayloadResolver.SecretResolutionException | IllegalArgumentException e)
        {
            throw new PluginActionException(BackendErrorCode.VALIDATION, e.getMessage(), null);
        }
        catch (Exception | LinkageError e)
        {
            // LinkageError: e.g. a class of an optional dependency that isn't there. The caller must get an answer, not a timeout
            throw new PluginActionException(BackendErrorCode.INTERNAL, ErrorMessages.buildFailureMessage(e), ErrorMessages.buildErrorDetails(e), e);
        }
    }

    public static final class PluginActionException extends RuntimeException
    {
        private final BackendErrorCode code;
        private final Map<String, Object> details;

        PluginActionException(BackendErrorCode code, String message, Map<String, Object> details)
        {
            this(code, message, details, null);
        }

        public PluginActionException(BackendErrorCode code, String message, Map<String, Object> details, Throwable cause)
        {
            super(message, cause);
            this.code = code;
            this.details = details;
        }

        public BackendErrorCode code()
        {
            return code;
        }

        public Map<String, Object> details()
        {
            return details;
        }
    }
}
