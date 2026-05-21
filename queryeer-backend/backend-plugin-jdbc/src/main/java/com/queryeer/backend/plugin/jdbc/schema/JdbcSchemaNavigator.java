package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.plugin.jdbc.JdbcUtils;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

public final class JdbcSchemaNavigator
{
    public record TableInfo(String name, String kind, String database)
    {
        public TableInfo(String name, String kind)
        {
            this(name, kind, null);
        }
    }

    private final DefaultJdbcConnections connections;
    private final JdbcSchemaStore schemaStore;
    private final JdbcSchemaRouter router;
    private final JdbcConnectionHealth connectionHealth;

    public JdbcSchemaNavigator(DefaultJdbcConnections connections, JdbcSchemaStore schemaStore, JdbcSchemaRouter router, JdbcConnectionHealth connectionHealth)
    {
        this.connections = connections;
        this.schemaStore = schemaStore;
        this.router = router;
        this.connectionHealth = connectionHealth;
    }

    public List<TableInfo> tableNamesForCompletion(String connectionId, String selectedDatabase)
    {
        List<TableInfo> cached = schemaStore.tableNamesForCompletion(connectionId, selectedDatabase)
                .stream()
                .map(entry -> new TableInfo(entry.name(), entry.kind(), entry.database()))
                .toList();
        if (!cached.isEmpty())
        {
            return cached;
        }

        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        List<JdbcSchemaObject> snapshot = loadSnapshotForLookup(connectionId, selectedDatabase, normalizedSelectedDatabase);
        List<TableInfo> tableInfos = new ArrayList<>();
        collectTableNames(snapshot, new NodePath(null, null), normalizedSelectedDatabase, tableInfos);
        return tableInfos;
    }

    /**
     * Returns column names for the given table. First tries the cached DEEP snapshot (which now includes columns), then falls back to live JDBC.
     */
    public List<String> columnNamesForTable(String connectionId, String tableName, String selectedDatabase)
    {
        return columnNamesForTables(connectionId, List.of(tableName), selectedDatabase).getOrDefault(tableName, List.of());
    }

    /**
     * Returns column names for multiple tables in a single snapshot load. This avoids opening the H2 store (via {@link #loadSnapshotForLookup}) once per table.
     */
    public Map<String, List<String>> columnNamesForTables(String connectionId, List<String> tableNames, String selectedDatabase)
    {
        Map<String, List<String>> result = new java.util.LinkedHashMap<>();
        if (tableNames == null
                || tableNames.isEmpty())
        {
            return result;
        }
        result.putAll(schemaStore.columnNamesForTables(connectionId, tableNames, selectedDatabase));
        if (result.values()
                .stream()
                .anyMatch(columns -> columns != null
                        && !columns.isEmpty()))
        {
            return result;
        }
        result.clear();

        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        List<JdbcSchemaObject> snapshot = loadSnapshotForLookup(connectionId, selectedDatabase, normalizedSelectedDatabase);
        for (String tableName : tableNames)
        {
            result.put(tableName, collectColumnNames(snapshot, tableName));
        }
        return result;
    }

    /** Walks the schema tree to find a table node by name and collect its column names. */
    private static List<String> collectColumnNames(List<JdbcSchemaObject> nodes, String lookupTable)
    {
        String normalizedLookup = JdbcUtils.normalizeIdentifier(lookupTable);
        if (normalizedLookup == null)
        {
            return List.of();
        }
        QualifiedTable lookup = parseQualifiedTable(lookupTable);
        List<String> result = new ArrayList<>();
        collectColumnNamesRecursive(nodes, new NodePath(null, null), lookup.name(), lookup.schema(), lookup.database(), result);
        return result;
    }

    private static void collectColumnNamesRecursive(List<JdbcSchemaObject> nodes, NodePath path, String normalizedLookupTable, String normalizedLookupSchema, String normalizedLookupDatabase,
            List<String> target)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            NodePath nextPath = path;

            if (kind == null)
            {
                continue;
            }

            if (kind.endsWith("_container")
                    || kind.endsWith("_folder"))
            {
                // fall through to children recursion
            }
            else if ("database".equalsIgnoreCase(kind))
            {
                nextPath = path.withDatabase(trimToNull(node.name()));
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = nextPath.withSchema(trimToNull(node.name()));
            }

            if ("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
            {
                String name = trimToNull(node.name());
                if (name != null
                        && JdbcUtils.normalizeIdentifier(name)
                                .equals(normalizedLookupTable))
                {
                    if (normalizedLookupDatabase != null
                            && nextPath.database() != null
                            && !normalizedLookupDatabase.equals(JdbcUtils.normalizeIdentifier(nextPath.database())))
                    {
                        continue;
                    }
                    // If a schema qualifier was specified, check it
                    if (normalizedLookupSchema != null)
                    {
                        String effectiveSchema = effectiveSchema(nextPath.schema(), node);
                        if (effectiveSchema == null
                                || !JdbcUtils.normalizeIdentifier(effectiveSchema)
                                        .equals(normalizedLookupSchema))
                        {
                            // Schema mismatch — continue searching
                            List<JdbcSchemaObject> children = node.children();
                            if (children != null
                                    && !children.isEmpty())
                            {
                                collectColumnNamesRecursive(children, nextPath, normalizedLookupTable, normalizedLookupSchema, normalizedLookupDatabase, target);
                            }
                            continue;
                        }
                    }
                    // Found the table — collect columns from columns_folder or direct children
                    if (node.children() != null)
                    {
                        for (JdbcSchemaObject child : node.children())
                        {
                            String childKind = trimToNull(child.kind());
                            if ("columns_folder".equalsIgnoreCase(childKind))
                            {
                                List<JdbcSchemaObject> folderChildren = child.children();
                                if (folderChildren != null)
                                {
                                    for (JdbcSchemaObject colNode : folderChildren)
                                    {
                                        if ("column".equalsIgnoreCase(trimToNull(colNode.kind())))
                                        {
                                            String colName = trimToNull(colNode.name());
                                            if (colName != null)
                                            {
                                                target.add(colName);
                                            }
                                        }
                                    }
                                }
                            }
                            else if ("column".equalsIgnoreCase(childKind))
                            {
                                String colName = trimToNull(child.name());
                                if (colName != null)
                                {
                                    target.add(colName);
                                }
                            }
                        }
                    }
                    return; // Stop searching once the table is found
                }
            }

            List<JdbcSchemaObject> children = node.children();
            if (children != null
                    && !children.isEmpty())
            {
                collectColumnNamesRecursive(children, nextPath, normalizedLookupTable, normalizedLookupSchema, normalizedLookupDatabase, target);
                // If we found columns in this subtree, stop
                if (!target.isEmpty())
                {
                    return;
                }
            }
        }
    }

    public Map<String, Object> findSymbol(String connectionId, String rawToken, String selectedDatabase)
    {
        if (isBlank(rawToken))
        {
            return null;
        }
        String normalizedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        // Try DEEP cache first
        JdbcSchemaStore.SymbolLookupEntry cached = schemaStore.findSymbol(connectionId, rawToken, selectedDatabase);
        Map<String, Object> result = cached != null ? Map.of("kind", cached.kind(), "name", cached.name(), "detail", cached.detail())
                : findSymbolInSchema(loadCachedSnapshot(connectionId), rawToken, normalizedDatabase);
        if (result != null)
        {
            return result;
        }
        // Skip live fallback for known-broken connections
        if (connectionId == null
                || !connectionHealth.isHealthy(connectionId))
        {
            return null;
        }
        try
        {
            JdbcConnection resolved = connections.resolve(connectionId);
            // Pass null target — target.matches rejects rows when schema is null
            List<JdbcSchemaObject> liveTables = router.resolve(resolved, "tables_folder", null);
            Map<String, Object> liveResult = findSymbolInSchema(liveTables, rawToken, normalizedDatabase);
            if (liveResult != null)
            {
                return liveResult;
            }
            List<JdbcSchemaObject> liveViews = router.resolve(resolved, "views_folder", null);
            return findSymbolInSchema(liveViews, rawToken, normalizedDatabase);
        }
        catch (RuntimeException e)
        {
            return null;
        }
    }

    private List<JdbcSchemaObject> loadSnapshotForLookup(String connectionId, String selectedDatabase, String normalizedSelectedDatabase)
    {
        // Use DEEP cache first (fast, no live connection). Only use it if it
        // actually contains table data — broken crawl data with folder shells only
        // (all rows filtered by null-schema target.matches) is useless for completion.
        List<JdbcSchemaObject> snapshot = schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP);
        if (!snapshot.isEmpty()
                && containsTableData(snapshot))
        {
            return snapshot;
        }

        return List.of();
    }

    private static boolean containsTableData(List<JdbcSchemaObject> nodes)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = node.kind();
            if ("table".equals(kind)
                    || "view".equals(kind))
            {
                return true;
            }
            if (node.children() != null
                    && containsTableData(node.children()))
            {
                return true;
            }
        }
        return false;
    }

    public List<JdbcSchemaObject> loadDeepSnapshot(String connectionId)
    {
        return schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP);
    }

    private List<JdbcSchemaObject> loadCachedSnapshot(String connectionId)
    {
        return loadDeepSnapshot(connectionId);
    }

    private static Map<String, Object> findSymbolInSchema(List<JdbcSchemaObject> snapshot, String rawToken, String normalizedDatabase)
    {
        QualifiedTable lookup = parseQualifiedTable(rawToken);
        if (isBlank(lookup.name()))
        {
            return null;
        }
        return searchSchemaTree(snapshot, new NodePath(null, null), lookup.database() != null ? lookup.database()
                : normalizedDatabase, lookup.schema(), lookup.name());
    }

    private static Map<String, Object> searchSchemaTree(List<JdbcSchemaObject> nodes, NodePath path, String filterDatabase, String filterSchema, String lookupTable)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            if (kind == null)
            {
                continue;
            }

            NodePath nextPath = path;
            // CONTAINER/FOLDER nodes are transparent — recurse without path change
            if (kind.endsWith("_container")
                    || kind.endsWith("_folder"))
            {
                // fall through to children recursion below
            }
            else if ("database".equalsIgnoreCase(kind))
            {
                nextPath = path.withDatabase(trimToNull(node.name()));
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = path.withSchema(trimToNull(node.name()));
            }
            else if ("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
            {
                if (filterDatabase != null
                        && nextPath.database() != null
                        && !filterDatabase.equals(JdbcUtils.normalizeIdentifier(nextPath.database())))
                {
                    continue;
                }

                String effectiveSchema = effectiveSchema(nextPath.schema(), node);
                String tableName = trimToNull(node.name());
                if (tableName != null
                        && JdbcUtils.normalizeIdentifier(tableName)
                                .equals(lookupTable))
                {
                    if (filterSchema != null
                            && effectiveSchema != null
                            && !filterSchema.equals(JdbcUtils.normalizeIdentifier(effectiveSchema)))
                    {
                        continue;
                    }
                    String displayName = effectiveSchema != null ? effectiveSchema + "." + tableName
                            : tableName;
                    return Map.of("kind", kind.toLowerCase(), "name", displayName, "detail", kind.toUpperCase());
                }
            }

            List<JdbcSchemaObject> children = node.children();
            if (children != null
                    && !children.isEmpty())
            {
                Map<String, Object> result = searchSchemaTree(children, nextPath, filterDatabase, filterSchema, lookupTable);
                if (result != null)
                {
                    return result;
                }
            }
        }
        return null;
    }

    private static void collectTableNames(List<JdbcSchemaObject> nodes, NodePath path, String normalizedSelectedDatabase, List<TableInfo> target)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            NodePath nextPath = path;

            // CONTAINER/FOLDER nodes are transparent — recurse without path change
            if (kind.endsWith("_container")
                    || kind.endsWith("_folder"))
            {
                // fall through to children recursion
            }
            else if ("database".equalsIgnoreCase(kind))
            {
                nextPath = path.withDatabase(trimToNull(node.name()));
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = nextPath.withSchema(trimToNull(node.name()));
            }
            if ("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
            {
                String normalizedNodeDatabase = JdbcUtils.normalizeIdentifier(nextPath.database());
                if (normalizedSelectedDatabase != null
                        && normalizedNodeDatabase != null
                        && !normalizedSelectedDatabase.equals(normalizedNodeDatabase))
                {
                    continue;
                }
                String name = trimToNull(node.name());
                if (name != null)
                {
                    String effectiveSchema = effectiveSchema(nextPath.schema(), node);
                    String displayName = effectiveSchema == null ? name
                            : effectiveSchema + "." + name;
                    target.add(new TableInfo(displayName, kind.toLowerCase(), nextPath.database()));
                }
            }

            List<JdbcSchemaObject> children = node.children();
            if (children != null
                    && !children.isEmpty())
            {
                collectTableNames(children, nextPath, normalizedSelectedDatabase, target);
            }
        }
    }

    private static String effectiveSchema(String schemaFromPath, JdbcSchemaObject node)
    {
        if (schemaFromPath != null)
        {
            return schemaFromPath;
        }
        if (node.attributes() != null
                && node.attributes()
                        .get("schema") instanceof String attrSchema)
        {
            return trimToNull(attrSchema);
        }
        return null;
    }

    private static QualifiedTable parseQualifiedTable(String value)
    {
        String normalized = JdbcUtils.normalizeIdentifier(value);
        if (normalized == null)
        {
            return new QualifiedTable(null, null, null);
        }
        String[] parts = normalized.split("\\.");
        if (parts.length >= 3)
        {
            return new QualifiedTable(parts[parts.length - 3], parts[parts.length - 2], parts[parts.length - 1]);
        }
        if (parts.length == 2)
        {
            return new QualifiedTable(null, parts[0], parts[1]);
        }
        return new QualifiedTable(null, null, parts[0]);
    }

    private record NodePath(String database, String schema)
    {
        private NodePath withDatabase(String value)
        {
            return new NodePath(value, schema);
        }

        private NodePath withSchema(String value)
        {
            return new NodePath(database, value);
        }
    }

    private record QualifiedTable(String database, String schema, String name)
    {
    }
}
