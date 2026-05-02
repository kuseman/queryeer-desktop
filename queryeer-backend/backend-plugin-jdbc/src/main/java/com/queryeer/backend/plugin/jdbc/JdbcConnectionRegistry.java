package com.queryeer.backend.plugin.jdbc;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

final class JdbcConnectionRegistry
{
    private final Map<String, JdbcStoredConnection> byId = new ConcurrentHashMap<>();

    JdbcStoredConnection upsert(String connectionId, String name, Map<String, Object> connection)
    {
        return byId.compute(connectionId, (id, existing) ->
        {
            long version = existing == null ? 1L
                    : existing.version()
                            .incrementAndGet();
            AtomicLong versionRef = existing == null ? new AtomicLong(version)
                    : existing.version();
            versionRef.set(version);
            Map<String, Object> normalizedConnection = connection == null ? Map.of()
                    : new LinkedHashMap<>(connection);
            return new JdbcStoredConnection(connectionId, versionRef, name, normalizedConnection);
        })
                .snapshot();
    }

    Optional<JdbcStoredConnection> get(String connectionId)
    {
        JdbcStoredConnection value = byId.get(connectionId);
        return value == null ? Optional.empty()
                : Optional.of(value.snapshot());
    }

    List<JdbcStoredConnection> all()
    {
        return byId.values()
                .stream()
                .map(JdbcStoredConnection::snapshot)
                .toList();
    }

    /**
     * Replaces the registry contents with the supplied configuration list. Connections present in {@code configurations} are upserted; connections that have disappeared from the list are removed.
     * Disabled connections ({@code enabled=false}) are treated as removed.
     */
    void reload(List<JdbcSettingsConnectionSource.JdbcConfiguredConnection> configurations)
    {
        Set<String> activeIds = new HashSet<>();
        for (JdbcSettingsConnectionSource.JdbcConfiguredConnection configured : configurations)
        {
            Object enabled = configured.connection()
                    .get("enabled");
            if (enabled instanceof Boolean bool
                    && !bool)
            {
                continue;
            }
            upsert(configured.connectionId(), configured.name(), configured.connection());
            activeIds.add(configured.connectionId());
        }
        byId.keySet()
                .retainAll(activeIds);
    }

    record JdbcStoredConnection(String connectionId, AtomicLong version, String name, Map<String, Object> connection)
    {
        JdbcStoredConnection snapshot()
        {
            return new JdbcStoredConnection(connectionId, new AtomicLong(version.get()), name, new LinkedHashMap<>(connection));
        }
    }
}
