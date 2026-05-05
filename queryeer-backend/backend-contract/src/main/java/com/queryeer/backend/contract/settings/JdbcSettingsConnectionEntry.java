package com.queryeer.backend.contract.settings;

import java.util.Map;

/**
 * A single connection entry inside the JDBC settings module.
 */
public record JdbcSettingsConnectionEntry(String connectionId, String dialectId, String url, String username, Object password, Map<String, Object> properties, Boolean enabled, String title)
{
}
