package com.queryeer.backend.queryengine.jdbc;

import java.util.Map;

public record JdbcConnection(String connectionId, String title, JdbcDialect dialect, Map<String, Object> properties)
{
    public static final String KEY_USERNAME = "username";
    public static final String KEY_PASSWORD = "password";
    public static final String KEY_URL = "url";
}
