package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class DefaultJdbcDialectRegistry implements JdbcDialectRegistry
{
    private final Map<String, JdbcDialect> dialectsById = new ConcurrentHashMap<>();

    @Override
    public void register(JdbcDialect dialect)
    {
        if (dialect == null)
        {
            throw new IllegalArgumentException("dialect is required");
        }

        JdbcDialectMetadata metadata = dialect.metadata();
        if (metadata == null)
        {
            throw new IllegalArgumentException("dialect metadata is required");
        }

        String dialectId = metadata.id();
        if (dialectId == null
                || dialectId.isBlank())
        {
            throw new IllegalArgumentException("dialect id is required");
        }

        JdbcDialect previous = dialectsById.putIfAbsent(dialectId, dialect);
        if (previous != null)
        {
            throw new IllegalArgumentException("dialect already registered: " + dialectId);
        }
    }

    @Override
    public Optional<JdbcDialect> find(String dialectId)
    {
        return Optional.ofNullable(dialectsById.get(dialectId));
    }

    @Override
    public List<JdbcDialectMetadata> all()
    {
        return dialectsById.values()
                .stream()
                .map(JdbcDialect::metadata)
                .sorted((left, right) -> left.id()
                        .compareToIgnoreCase(right.id()))
                .toList();
    }
}
