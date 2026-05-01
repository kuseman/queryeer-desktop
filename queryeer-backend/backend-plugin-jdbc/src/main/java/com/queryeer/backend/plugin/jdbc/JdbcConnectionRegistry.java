package com.queryeer.backend.plugin.jdbc;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

    record JdbcStoredConnection(String connectionId, AtomicLong version, String name, Map<String, Object> connection)
    {
        JdbcStoredConnection snapshot()
        {
            return new JdbcStoredConnection(connectionId, new AtomicLong(version.get()), name, new LinkedHashMap<>(connection));
        }
    }
}
