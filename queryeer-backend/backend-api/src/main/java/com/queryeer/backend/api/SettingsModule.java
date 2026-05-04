package com.queryeer.backend.api;

import java.util.Map;

/**
 * A settings module document read from disk by {@link ConfigService}.
 */
public record SettingsModule(String moduleId, long version, String updatedAt, Map<String, Object> values)
{
}
