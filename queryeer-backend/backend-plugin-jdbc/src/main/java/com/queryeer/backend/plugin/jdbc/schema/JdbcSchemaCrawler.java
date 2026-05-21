package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaCrawler
{
    private static final String KEY_CATALOG = "catalog";
    private static final String KEY_SCHEMA = "schema";

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
                    || isBlank(target.database()))
            {
                return;
            }
            // Always pass the database to the router. When schema is null we use
            // targetMatches() fallback that filters by database only (not schema).
            JdbcSchemaTarget crawlTarget = new JdbcSchemaTarget(target.database(), target.schema());
            List<JdbcSchemaObject> tables = router.resolve(connection, "tables_folder", crawlTarget);
            List<JdbcSchemaObject> views = router.resolve(connection, "views_folder", crawlTarget);
            List<JdbcSchemaObject> expandedTables = expandTableColumns(connection, tables);
            List<JdbcSchemaObject> expandedViews = expandTableColumns(connection, views);
            List<JdbcSchemaObject> allFetched = new ArrayList<>(expandedTables.size() + expandedViews.size());
            allFetched.addAll(expandedTables);
            allFetched.addAll(expandedViews);
            List<JdbcSchemaObject> current = new ArrayList<>(store.latestSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP));
            mergeTablesScope(current, target.database(), target.schema(), allFetched);
            store.persistSnapshot(connection.connectionId(), JdbcSchemaCrawlScope.DEEP, current);
            return;
        }

        List<JdbcSchemaObject> objects = router.resolve(connection, "databases_container", target);

        store.persistSnapshot(connection.connectionId(), scope, objects);
    }

    /**
     * For each table node in the fetched list, resolve its columns and indexes via the router and attach them as folder children. This ensures column and index data is persisted in the DEEP snapshot
     * and available for completion without live JDBC queries.
     */
    private List<JdbcSchemaObject> expandTableColumns(JdbcConnection connection, List<JdbcSchemaObject> tables)
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        for (JdbcSchemaObject table : tables)
        {
            String catalog = stringValue(table.attributes(), KEY_CATALOG);
            String schema = stringValue(table.attributes(), KEY_SCHEMA);
            String tableName = table.name();
            if (tableName == null
                    || tableName.isBlank())
            {
                continue;
            }
            JdbcSchemaTarget tableTarget = new JdbcSchemaTarget(catalog != null
                    && !catalog.isBlank() ? catalog
                            : null,
                    schema != null
                            && !schema.isBlank() ? schema
                                    : null,
                    tableName);
            List<JdbcSchemaObject> columns;
            try
            {
                columns = router.resolve(connection, "columns_folder", tableTarget);
            }
            catch (RuntimeException e)
            {
                System.err.println("[WARN] Failed to resolve columns for " + tableName + ": " + e.getMessage());
                columns = List.of();
            }
            List<JdbcSchemaObject> indexes;
            try
            {
                indexes = router.resolve(connection, "indexes_folder", tableTarget);
            }
            catch (RuntimeException e)
            {
                System.err.println("[WARN] Failed to resolve indexes for " + tableName + ": " + e.getMessage());
                indexes = List.of();
            }
            Map<String, Object> folderAttrs = new java.util.LinkedHashMap<>(table.attributes());
            folderAttrs.put("table", tableName);
            List<JdbcSchemaObject> folderChildren = new ArrayList<>();
            if (!columns.isEmpty())
            {
                folderChildren.add(new JdbcSchemaObject("columns_folder:" + key(catalog, schema) + ":" + tableName, "Columns", "columns_folder", List.copyOf(columns), Map.copyOf(folderAttrs)));
            }
            if (!indexes.isEmpty())
            {
                folderChildren.add(new JdbcSchemaObject("indexes_folder:" + key(catalog, schema) + ":" + tableName, "Indexes", "indexes_folder", List.copyOf(indexes), Map.copyOf(folderAttrs)));
            }
            result.add(new JdbcSchemaObject(table.id(), table.name(), table.kind(), table.nodeType(), table.fullName(), List.copyOf(folderChildren), table.attributes()));
        }
        return result;
    }

    private static String key(String... values)
    {
        return java.util.Arrays.stream(values)
                .map(v -> v == null ? ""
                        : v)
                .collect(java.util.stream.Collectors.joining("|"));
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
