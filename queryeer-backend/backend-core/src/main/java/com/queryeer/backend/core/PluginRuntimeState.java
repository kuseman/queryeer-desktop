package com.queryeer.backend.core;

public enum PluginRuntimeState
{
    LOADED,
    SKIPPED,
    ACTIVATED,
    FAILED,
    DEACTIVATED;

    public String wireValue()
    {
        return name().toLowerCase();
    }
}
