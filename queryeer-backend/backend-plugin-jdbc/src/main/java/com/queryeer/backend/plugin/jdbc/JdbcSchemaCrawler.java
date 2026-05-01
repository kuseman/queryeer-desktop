package com.queryeer.backend.plugin.jdbc;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;

final class JdbcSchemaCrawler
{
    private final JdbcDialectRegistry registry;
    private final JdbcSchemaStore store;
    private final LoggerService logger;

    JdbcSchemaCrawler(JdbcDialectRegistry registry, JdbcSchemaStore store, LoggerService logger)
    {
        this.registry = registry;
        this.store = store;
        this.logger = logger;
    }

    void crawl(JdbcConnectionRegistry.JdbcStoredConnection stored, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        String dialectId = stringValue(stored.connection()
                .get("dialectId"));
        if (dialectId == null)
        {
            dialectId = "jdbc";
        }
        JdbcDialect dialect = registry.find(dialectId)
                .orElse(null);
        if (dialect == null)
        {
            logger.warn("Skipping schema crawl, dialect not found: " + dialectId + " for connection " + stored.connectionId());
            return;
        }
        Map<String, Object> options = Map.of("scope", scope.name()
                .toLowerCase(), "target",
                target == null ? Map.of()
                        : Map.of("database", target.database() == null ? ""
                                : target.database(), "schema", target.schema()));
        List<JdbcSchemaObject> objects = dialect.schemaResolver()
                .resolveSchema(toProfile(stored, dialectId), options);
        store.persistSnapshot(stored.connectionId(), scope, objects);
    }

    private static JdbcConnectionProfile toProfile(JdbcConnectionRegistry.JdbcStoredConnection stored, String dialectId)
    {
        return new JdbcConnectionProfile(stored.connectionId(), stored.name(), dialectId, Map.copyOf(stored.connection()));
    }

    private static String stringValue(Object value)
    {
        if (value instanceof String stringValue)
        {
            String trimmed = stringValue.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }
}
