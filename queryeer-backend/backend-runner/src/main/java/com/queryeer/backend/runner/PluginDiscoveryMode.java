package com.queryeer.backend.runner;

enum PluginDiscoveryMode
{
    AUTO,
    BUILTIN,
    EXTERNAL,
    MIXED;

    static PluginDiscoveryMode parse(String value)
    {
        if (value == null
                || value.isBlank())
        {
            return AUTO;
        }

        String normalized = value.trim()
                .toUpperCase();
        for (PluginDiscoveryMode mode : values())
        {
            if (mode.name()
                    .equals(normalized))
            {
                return mode;
            }
        }

        throw new PluginDiscoveryException("Unsupported plugin discovery mode: " + value + " (expected one of auto,builtin,external,mixed)");
    }
}
