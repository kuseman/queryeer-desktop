package com.queryeer.backend.plugin.jdbc;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;

final class JdbcConnectionRegistry
{
    private final Map<String, JdbcStoredConnection> byId = new ConcurrentHashMap<>();
    private final ConfigService config;
    private final JdbcSettingsConnectionSource source;
    private final LoggerService logger;

    JdbcConnectionRegistry()
    {
        this(null, null, null);
    }

    JdbcConnectionRegistry(ConfigService config, JdbcSettingsConnectionSource source, LoggerService logger)
    {
        this.config = config;
        this.source = source;
        this.logger = logger;
    }

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
                    : new java.util.LinkedHashMap<>(connection);
            return new JdbcStoredConnection(connectionId, versionRef, name, normalizedConnection);
        })
                .snapshot();
    }

    Optional<JdbcStoredConnection> get(String connectionId)
    {
        JdbcStoredConnection value = byId.get(connectionId);
        if (value != null)
        {
            return Optional.of(value.snapshot());
        }
        return loadConfigured(connectionId);
    }

    List<JdbcStoredConnection> all()
    {
        List<JdbcStoredConnection> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        if (config != null
                && source != null)
        {
            for (JdbcSettingsConnectionSource.JdbcConfiguredConnection configured : source.load(config, logger))
            {
                seen.add(configured.connectionId());
                result.add(toStoredConnection(configured));
            }
        }
        for (JdbcStoredConnection adHoc : byId.values())
        {
            if (!seen.contains(adHoc.connectionId()))
            {
                result.add(adHoc.snapshot());
            }
        }
        return List.copyOf(result);
    }

    private Optional<JdbcStoredConnection> loadConfigured(String connectionId)
    {
        if (config == null
                || source == null)
        {
            return Optional.empty();
        }
        for (JdbcSettingsConnectionSource.JdbcConfiguredConnection configured : source.load(config, logger))
        {
            if (connectionId.equals(configured.connectionId()))
            {
                return Optional.of(toStoredConnection(configured));
            }
        }
        return Optional.empty();
    }

    private JdbcStoredConnection toStoredConnection(JdbcSettingsConnectionSource.JdbcConfiguredConnection configured)
    {
        Map<String, Object> conn = new java.util.LinkedHashMap<>(configured.connection());
        AtomicLong version = new AtomicLong(0L);
        return new JdbcStoredConnection(configured.connectionId(), version, configured.name(), conn);
    }

    record JdbcStoredConnection(String connectionId, AtomicLong version, String name, Map<String, Object> connection)
    {
        JdbcStoredConnection snapshot()
        {
            return new JdbcStoredConnection(connectionId, new AtomicLong(version.get()), name, new java.util.LinkedHashMap<>(connection));
        }
    }
}
