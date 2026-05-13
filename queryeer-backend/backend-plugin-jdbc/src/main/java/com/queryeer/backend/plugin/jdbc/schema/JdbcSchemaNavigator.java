package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

public final class JdbcSchemaNavigator
{
    private final DefaultJdbcConnections connections;
    private final JdbcSchemaStore schemaStore;

    public JdbcSchemaNavigator(DefaultJdbcConnections connections, JdbcSchemaStore schemaStore)
    {
        this.connections = connections;
        this.schemaStore = schemaStore;
    }

    public List<String> tableNamesForCompletion(String connectionId, String selectedDatabase)
    {
        String normalizedSelectedDatabase = normalizeIdentifier(selectedDatabase);
        List<JdbcSchemaObject> snapshot = loadSnapshotForLookup(connectionId, selectedDatabase, normalizedSelectedDatabase);
        List<String> tableNames = new ArrayList<>();
        collectTableNames(snapshot, new NodePath(null, null), normalizedSelectedDatabase, tableNames);
        return tableNames;
    }

    public Map<String, Object> findSymbol(String connectionId, String rawToken, String selectedDatabase)
    {
        if (isBlank(rawToken))
        {
            return null;
        }
        String normalizedDatabase = normalizeIdentifier(selectedDatabase);
        List<JdbcSchemaObject> snapshot = loadCachedSnapshot(connectionId);
        return findSymbolInSchema(snapshot, rawToken, normalizedDatabase);
    }

    private List<JdbcSchemaObject> loadSnapshotForLookup(String connectionId, String selectedDatabase, String normalizedSelectedDatabase)
    {
        List<JdbcSchemaObject> snapshot = loadCachedSnapshot(connectionId);
        if (!snapshot.isEmpty())
        {
            return snapshot;
        }

        try
        {
            JdbcConnection resolved = connections.resolve(connectionId);
            return resolved.dialect()
                    .schemaResolver()
                    .resolveSchema(resolved, normalizedSelectedDatabase == null ? Map.of("scope", "tables")
                            : Map.of("scope", "tables", "target", Map.of("database", selectedDatabase)));
        }
        catch (RuntimeException e)
        {
            return List.of();
        }
    }

    private List<JdbcSchemaObject> loadCachedSnapshot(String connectionId)
    {
        List<JdbcSchemaObject> snapshot = schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP);
        if (snapshot.isEmpty())
        {
            snapshot = schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.TOP);
        }
        return snapshot;
    }

    private static Map<String, Object> findSymbolInSchema(List<JdbcSchemaObject> snapshot, String rawToken, String normalizedDatabase)
    {
        String[] parts = rawToken.split("\\.", 2);
        String lookupTable = normalizeIdentifier(parts.length == 2 ? parts[1]
                : parts[0]);
        String lookupSchema = parts.length == 2 ? normalizeIdentifier(parts[0])
                : null;
        if (isBlank(lookupTable))
        {
            return null;
        }
        return searchSchemaTree(snapshot, new NodePath(null, null), normalizedDatabase, lookupSchema, lookupTable);
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
            if ("database".equalsIgnoreCase(kind))
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
                        && !filterDatabase.equals(normalizeIdentifier(nextPath.database())))
                {
                    continue;
                }

                String effectiveSchema = effectiveSchema(nextPath.schema(), node);
                String tableName = trimToNull(node.name());
                if (tableName != null
                        && normalizeIdentifier(tableName).equals(lookupTable))
                {
                    if (filterSchema != null
                            && effectiveSchema != null
                            && !filterSchema.equals(normalizeIdentifier(effectiveSchema)))
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

    private static void collectTableNames(List<JdbcSchemaObject> nodes, NodePath path, String normalizedSelectedDatabase, List<String> target)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            NodePath nextPath = path;
            if ("database".equalsIgnoreCase(kind))
            {
                nextPath = path.withDatabase(trimToNull(node.name()));
            }
            if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = nextPath.withSchema(trimToNull(node.name()));
            }
            if ("table".equalsIgnoreCase(kind))
            {
                String normalizedNodeDatabase = normalizeIdentifier(nextPath.database());
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
                    target.add(effectiveSchema == null ? name
                            : effectiveSchema + "." + name);
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

    private static String normalizeIdentifier(String value)
    {
        String trimmed = trimToNull(value);
        if (trimmed == null)
        {
            return null;
        }
        String unwrapped = trimmed;
        if (unwrapped.startsWith("[")
                && unwrapped.endsWith("]")
                && unwrapped.length() > 1)
        {
            unwrapped = unwrapped.substring(1, unwrapped.length() - 1);
        }
        if ((unwrapped.startsWith("\"")
                && unwrapped.endsWith("\""))
                || (unwrapped.startsWith("`")
                        && unwrapped.endsWith("`")
                        || (unwrapped.startsWith("'")
                                && unwrapped.endsWith("'"))))
        {
            if (unwrapped.length() > 1)
            {
                unwrapped = unwrapped.substring(1, unwrapped.length() - 1);
            }
        }
        return unwrapped.trim()
                .toLowerCase();
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
}
