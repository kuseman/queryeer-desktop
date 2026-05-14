package com.queryeer.backend.plugin.jdbc.schema;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaCrawler
{
    private final JdbcSchemaStore store;
    private final JdbcSchemaRouter router;

    public JdbcSchemaCrawler(JdbcSchemaStore store, JdbcSchemaRouter router)
    {
        this.store = store;
        this.router = router;
    }

    void crawl(JdbcConnection connection, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        if (scope == JdbcSchemaCrawlScope.DEEP)
        {
            // Skip if no database target — would only resolve to useless folder shells
            if (target == null
                    || target.database() == null
                    || target.database()
                            .isBlank())
            {
                return;
            }
            // Pass null target to router — target.matches rejects rows when schema is null,
            // which would filter out ALL tables. mergeTablesScope handles grouping by schema.
            List<JdbcSchemaObject> fetched = router.resolve(connection, "tables_folder", target.schema() != null ? target
                    : null);
            List<JdbcSchemaObject> current = new ArrayList<>(store.latestSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP));
            mergeTablesScope(current, target.database(), target.schema(), fetched);
            store.persistSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP, current);
            return;
        }

        List<JdbcSchemaObject> objects = router.resolve(connection, "databases_container", target);

        store.persistSnapshot(connection.connectionId(), scope, objects);
    }

    private static void mergeTablesScope(List<JdbcSchemaObject> roots, String database, String schema, List<JdbcSchemaObject> fetched)
    {
        String db = database == null
                || database.isBlank() ? "default"
                        : database;
        JdbcSchemaObject dbNode = upsertChild(roots, new JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<JdbcSchemaObject> dbChildren = mutableChildren(dbNode);

        if (schema != null
                && !schema.isBlank())
        {
            JdbcSchemaObject schemaNode = upsertChild(dbChildren, new JdbcSchemaObject(db + "." + schema, schema, "schema", List.of(), Map.of("catalog", db)));
            List<JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
            mergeInto(schemaChildren, fetched);
            replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
            replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
            return;
        }

        Map<String, List<JdbcSchemaObject>> bySchema = new LinkedHashMap<>();
        for (JdbcSchemaObject item : fetched)
        {
            String schemaName = schemaName(item);
            bySchema.computeIfAbsent(schemaName, _ -> new ArrayList<>())
                    .add(item);
        }

        for (Map.Entry<String, List<JdbcSchemaObject>> entry : bySchema.entrySet())
        {
            String schemaName = entry.getKey();
            JdbcSchemaObject schemaNode = upsertChild(dbChildren, new JdbcSchemaObject(db + "." + schemaName, schemaName, "schema", List.of(), Map.of("catalog", db)));
            List<JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
            mergeInto(schemaChildren, entry.getValue());
            replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
        }

        replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
    }

    private static String schemaName(JdbcSchemaObject object)
    {
        Object attr = object.attributes()
                .get("schema");
        if (attr instanceof String s
                && !s.isBlank())
        {
            return s;
        }
        return "public";
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
