package com.queryeer.backend.api;

import java.util.List;

public interface ChangelogRegistry
{
    void registerChangelog(String pluginId, String changelog);

    List<String> pluginIds();

    String getChangelog(String pluginId);
}
