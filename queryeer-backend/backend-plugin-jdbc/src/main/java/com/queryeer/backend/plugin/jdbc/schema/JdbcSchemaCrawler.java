package com.queryeer.backend.plugin.jdbc.schema;

import java.util.ArrayList;
import java.util.HashMap;
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
        if (scope == JdbcSchemaCrawlScope.DEEP
                && target != null
                && target.database() != null
                && !target.database()
                        .isBlank())
        {
            List<JdbcSchemaObject> fetched = fetchTables(connection, target);
            List<JdbcSchemaObject> current = new ArrayList<>(store.latestSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP));
            mergeTablesScope(current, target.database(), target.schema(), fetched);
            store.persistSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP, current);
            return;
        }

        Map<String, Object> options = new HashMap<>();
        options.put("scope", scope.name()
                .toLowerCase());
        if (target != null)
        {
            Map<String, Object> targetOptions = new HashMap<>();
            if (target.database() != null
                    && !target.database()
                            .isBlank())
            {
                targetOptions.put("database", target.database());
            }
            if (target.schema() != null
                    && !target.schema()
                            .isBlank())
            {
                targetOptions.put("schema", target.schema());
            }
            if (!targetOptions.isEmpty())
            {
                options.put("target", targetOptions);
            }
        }
        List<JdbcSchemaObject> objects = connection.dialect()
                .schemaResolver()
                .resolveSchema(connection, options);

        store.persistSnapshot(connection.connectionId(), scope, objects);
    }

    private static List<JdbcSchemaObject> fetchTables(JdbcConnection connection, JdbcSchemaTarget target)
    {
        Map<String, Object> options = new HashMap<>();
        options.put("scope", "tables");
        Map<String, Object> targetOptions = new HashMap<>();
        targetOptions.put("database", target.database());
        if (target.schema() != null
                && !target.schema()
                        .isBlank())
        {
            targetOptions.put("schema", target.schema());
        }
        options.put("target", targetOptions);
        return connection.dialect()
                .schemaResolver()
                .resolveSchema(connection, options);
    }

    private static void mergeTablesScope(List<JdbcSchemaObject> roots, String database, String schema, List<JdbcSchemaObject> fetched)
    {
        String db = database == null
                || database.isBlank() ? "default"
                        : database;
        JdbcSchemaObject dbNode = upsertChild(roots, new JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<JdbcSchemaObject> dbChildren = mutableChildren(dbNode);

        String inferredSchema = schema;
        if ((inferredSchema == null
                || inferredSchema.isBlank())
                && !fetched.isEmpty())
        {
            Object attr = fetched.get(0)
                    .attributes()
                    .get("schema");
            inferredSchema = attr instanceof String s ? s
                    : null;
        }
        String schemaName = inferredSchema == null
                || inferredSchema.isBlank() ? "public"
                        : inferredSchema;
        JdbcSchemaObject schemaNode = upsertChild(dbChildren, new JdbcSchemaObject(db + "." + schemaName, schemaName, "schema", List.of(), Map.of("catalog", db)));
        List<JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
        mergeInto(schemaChildren, fetched);
        replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
        replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
    }

    private static List<JdbcSchemaObject> mutableChildren(JdbcSchemaObject node)
    {
        return new ArrayList<>(node.children() == null ? List.of()
                : node.children());
    }

    private static JdbcSchemaObject withChildren(JdbcSchemaObject node, List<JdbcSchemaObject> children)
    {
        return new JdbcSchemaObject(node.id(), node.name(), node.kind(), List.copyOf(children), node.attributes());
    }

    private static void mergeInto(List<JdbcSchemaObject> target, List<JdbcSchemaObject> incoming)
    {
        for (JdbcSchemaObject item : incoming)
        {
            int existing = indexOf(target, item);
            if (existing >= 0)
            {
                target.set(existing, item);
            }
            else
            {
                target.add(item);
            }
        }
    }

    private static JdbcSchemaObject upsertChild(List<JdbcSchemaObject> target, JdbcSchemaObject candidate)
    {
        int idx = indexOf(target, candidate);
        if (idx >= 0)
        {
            return target.get(idx);
        }
        target.add(candidate);
        return candidate;
    }

    private static int indexOf(List<JdbcSchemaObject> list, JdbcSchemaObject node)
    {
        for (int i = 0; i < list.size(); i++)
        {
            JdbcSchemaObject current = list.get(i);
            if (current.id()
                    .equals(node.id()))
            {
                return i;
            }
        }
        return -1;
    }

    private static void replaceNode(List<JdbcSchemaObject> list, JdbcSchemaObject oldNode, JdbcSchemaObject updatedNode)
    {
        int idx = indexOf(list, oldNode);
        if (idx >= 0)
        {
            list.set(idx, updatedNode);
        }
    }
}
