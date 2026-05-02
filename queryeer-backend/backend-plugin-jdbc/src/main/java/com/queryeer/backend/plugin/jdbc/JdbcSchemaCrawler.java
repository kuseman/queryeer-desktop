package com.queryeer.backend.plugin.jdbc;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;

final class JdbcSchemaCrawler
{
    private final JdbcDialectRegistry registry;
    private final JdbcConnectionResolver resolver;
    private final JdbcSchemaStore store;
    private final LoggerService logger;

    JdbcSchemaCrawler(JdbcDialectRegistry registry, JdbcConnectionResolver resolver, JdbcSchemaStore store, LoggerService logger)
    {
        this.registry = registry;
        this.resolver = resolver;
        this.store = store;
        this.logger = logger;
    }

    void crawl(JdbcConnectionRegistry.JdbcStoredConnection stored, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        String dialectId = text(stored.connection()
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

        Optional<JdbcConnectionProfile> profileOpt = resolver.resolve(stored);
        if (profileOpt.isEmpty())
        {
            return; // session locked — skip silently
        }

        Map<String, Object> options = Map.of("scope", scope.name()
                .toLowerCase(), "target",
                target == null ? Map.of()
                        : Map.of("database", target.database() == null ? ""
                                : target.database(), "schema", target.schema()));
        List<JdbcSchemaObject> objects = dialect.schemaResolver()
                .resolveSchema(profileOpt.get(), options);
        store.persistSnapshot(stored.connectionId(), scope, objects);
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
