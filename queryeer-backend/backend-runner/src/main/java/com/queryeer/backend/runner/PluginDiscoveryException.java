package com.queryeer.backend.runner;

final class PluginDiscoveryException extends RuntimeException
{
    PluginDiscoveryException(String message)
    {
        super(message);
    }

    PluginDiscoveryException(String message, Throwable cause)
    {
        super(message, cause);
    }
}
