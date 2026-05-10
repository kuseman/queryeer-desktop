package com.queryeer.backend.plugin.jdbc.schema;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaCrawler
{
    private final JdbcSchemaStore store;

    public JdbcSchemaCrawler(JdbcSchemaStore store)
    {
        this.store = store;
    }

    void crawl(JdbcConnection connection, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        Map<String, Object> options = Map.of("scope", scope.name()
                .toLowerCase(), "target",
                target == null ? Map.of()
                        : Map.of("database", target.database() == null ? ""
                                : target.database(), "schema", target.schema()));
        List<JdbcSchemaObject> objects = connection.dialect()
                .schemaResolver()
                .resolveSchema(connection, options);

        store.persistSnapshot(connection.connectionId(), scope, objects);
    }
}
