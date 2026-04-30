package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

record JdbcExecutionState(String connectionId, String dialectId, String url, String username, String resolvedPassword)
{
    static JdbcExecutionState parse(Object state)
    {
        if (!(state instanceof Map<?, ?> map))
        {
            return new JdbcExecutionState(null, "jdbc", null, null, null);
        }

        Object jdbcObject = map.get("jdbc");
        if (!(jdbcObject instanceof Map<?, ?> jdbcMap))
        {
            return new JdbcExecutionState(null, "jdbc", null, null, null);
        }

        Object connectionObject = jdbcMap.get("connection");
        if (!(connectionObject instanceof Map<?, ?> connection))
        {
            return new JdbcExecutionState(null, "jdbc", null, null, null);
        }

        return new JdbcExecutionState(text(connection.get("connectionId"), null), text(connection.get("dialectId"), "jdbc"), text(connection.get("url"), null), text(connection.get("username"), null),
                text(connection.get("password"), null));
    }

    private static String text(Object value, String fallback)
    {
        if (value instanceof String stringValue)
        {
            String trimmed = stringValue.trim();
            return trimmed.isEmpty() ? fallback
                    : trimmed;
        }
        return fallback;
    }
}
