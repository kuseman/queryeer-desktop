package com.queryeer.backend.core;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.ChangelogRegistry;

final class InMemoryChangelogRegistry implements ChangelogRegistry
{
    private final Map<String, String> changelogsById = new LinkedHashMap<>();

    @Override
    public void registerChangelog(String pluginId, String changelog)
    {
        changelogsById.put(pluginId, changelog);
    }

    @Override
    public List<String> pluginIds()
    {
        return Collections.unmodifiableList(List.copyOf(changelogsById.keySet()));
    }

    @Override
    public String getChangelog(String pluginId)
    {
        return changelogsById.get(pluginId);
    }
}
