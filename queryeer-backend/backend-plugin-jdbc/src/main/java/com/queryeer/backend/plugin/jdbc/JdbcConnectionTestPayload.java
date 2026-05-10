package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

record JdbcConnectionTestPayload(String connectionId, String title, Map<String, Object> connection)
{
}
