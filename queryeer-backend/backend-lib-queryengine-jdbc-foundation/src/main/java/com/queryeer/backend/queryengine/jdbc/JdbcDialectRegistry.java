package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Optional;

public interface JdbcDialectRegistry
{
    void register(JdbcDialect dialect);

    Optional<JdbcDialect> find(String dialectId);

    List<JdbcDialectMetadata> all();
}
