package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

/**
 * Single pipeline for resolving a stored connection to a {@link JdbcConnectionProfile}. All backend-initiated paths that open a {@code java.sql.Connection} go through here.
 *
 * <p>
 * Returns a profile with raw properties (including any {@code secretRef} wrappers). Callers must materialize credentials via {@link JdbcCredentialResolver} right before opening a connection.
 * </p>
 */
final class JdbcConnectionResolver
{
    JdbcConnectionProfile resolve(JdbcConnectionRegistry.JdbcStoredConnection stored)
    {
        Map<String, Object> props = new java.util.LinkedHashMap<>(stored.connection());
        String dialectId = text(props.get("dialectId"));
        return new JdbcConnectionProfile(stored.connectionId(), stored.name(), dialectId != null ? dialectId
                : "jdbc", Map.copyOf(props));
    }

    private static String text(Object value)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }
}
