package com.queryeer.backend.api;

/**
 * Handles one of a plugin's backend actions ({@link PluginActionRegistry}). Called on a request thread; several calls may run at once.
 *
 * @since 0.23.0
 */
@FunctionalInterface
public interface PluginActionHandler
{
    /** The action's result, sent to the frontend as JSON; null for none. */
    Object invoke(Object payload) throws Exception;
}
