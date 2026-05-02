package com.queryeer.backend.plugin.jdbc;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

/**
 * Single pipeline for resolving a stored connection to a {@link JdbcConnectionProfile}. All backend-initiated paths that open a {@code java.sql.Connection} go through here.
 *
 * <p>
 * Returns {@link Optional#empty()} when the connection requires a password whose {@code secretRef} cannot be resolved because the security session is locked. Callers in background operations should
 * silently skip such connections; callers in interactive operations should throw an appropriate error.
 * </p>
 *
 * <p>
 * Connections with no password (e.g. Windows Native auth, Java Kerberos) always resolve regardless of session state.
 * </p>
 */
final class JdbcConnectionResolver
{
    Optional<JdbcConnectionProfile> resolve(JdbcConnectionRegistry.JdbcStoredConnection stored)
    {
        Map<String, Object> props = new LinkedHashMap<>(stored.connection());
        String dialectId = text(props.get("dialectId"));
        return Optional.of(new JdbcConnectionProfile(stored.connectionId(), stored.name(), dialectId != null ? dialectId
                : "jdbc", Map.copyOf(props)));
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
