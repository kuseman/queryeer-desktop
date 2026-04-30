package com.queryeer.backend.queryengine.jdbc;

import java.util.Map;

public record JdbcConnectionProfile(String connectionId, String name, String dialectId, Map<String, Object> properties)
{
}
