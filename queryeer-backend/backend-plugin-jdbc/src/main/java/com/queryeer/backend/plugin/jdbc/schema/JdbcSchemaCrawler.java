package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.util.ArrayList;
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
            List<JdbcSchemaObject> procedures = router.resolve(connection, "procedures_folder", crawlTarget);
            List<JdbcSchemaObject> expandedTables = expandTableColumns(connection, tables);
            List<JdbcSchemaObject> expandedViews = expandTableColumns(connection, views);
            List<JdbcSchemaObject> allFetched = new ArrayList<>(expandedTables.size() + expandedViews.size() + procedures.size());
            allFetched.addAll(expandedTables);
            allFetched.addAll(expandedViews);
            allFetched.addAll(procedures);
            store.persistDeepSnapshotTarget(connection.connectionId(), target.database(), target.schema(), allFetched);
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
}
