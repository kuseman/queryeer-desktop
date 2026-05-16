package com.queryeer.backend.contract.about;

import java.util.List;

public record PluginChangelogsResult(List<BackendPluginChangelog> plugins)
{
    public record BackendPluginChangelog(String pluginId, String pluginName, String version, String changelog)
    {
    }
}
