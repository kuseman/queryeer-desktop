package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaNavigator;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.sql.parser.SqlCompletionSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlHoverSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlParseContext;

/** Handles SQL semantic operations (completion, hover, symbol lookup) against H2 schema snapshots. */
final class JdbcSqlSemanticHandler
{
    private final PayloadMapper payloadMapper;
    private final IncrementalParseSessionService parseSessions;
    private final String engineId;
    private final JdbcSchemaNavigator schemaNavigator;
    private final JdbcConnectionUsageListener usageListener;
    private final Function<String, String> fileToConnectionId;

    JdbcSqlSemanticHandler(PayloadMapper payloadMapper, IncrementalParseSessionService parseSessions, String engineId, JdbcSchemaNavigator schemaNavigator, JdbcConnectionUsageListener usageListener,
            Function<String, String> fileToConnectionId)
    {
        this.payloadMapper = payloadMapper;
        this.parseSessions = parseSessions;
        this.engineId = engineId;
        this.schemaNavigator = schemaNavigator;
        this.usageListener = usageListener;
        this.fileToConnectionId = fileToConnectionId;
    }

    // -- Completion --

    Object complete(String fileId, Object payload)
    {
        return SqlCompletionSupport.complete(payloadMapper, parseSessions, engineId, fileId, payload, this::semanticCompletions);
    }

    // -- Hover --

    Object hover(String fileId, Object payload)
    {
        return SqlHoverSupport.hover(payloadMapper, parseSessions, engineId, fileId, payload, this::semanticHover);
    }

    // -- Symbol at position --

    Object symbolAtPosition(String fileId, Object payload)
    {
        SqlSymbolAtPositionPayload params = payloadMapper.convert(payload, SqlSymbolAtPositionPayload.class);
        if (params == null
                || params.cursor() == null)
        {
            return null;
        }
        String token = SqlCompletionSupport.identifierAtPosition(parseSessions, engineId, fileId, params.text(), params.cursor()
                .line(),
                params.cursor()
                        .column());
        if (token == null)
        {
            return null;
        }
        String connectionId = resolveConnectionId(trimToNull(params.connectionId()), fileId);
        if (connectionId == null)
        {
            return null;
        }
        String selectedDatabase = trimToNull(params.database());
        recordUsage(connectionId, selectedDatabase);
        return schemaNavigator.findSymbol(connectionId, token, selectedDatabase);
    }

    // -- Parse snapshot --

    Object parseSnapshot(String fileId)
    {
        if (isBlank(fileId))
        {
            return Map.of();
        }
        return parseSessions.get(engineId, fileId)
                .map(snapshot -> Map.of("version", snapshot.version(), "languageId", snapshot.languageId(), "hasErrors", snapshot.hasErrors(), "attributes", snapshot.attributes()))
                .orElseGet(Map::of);
    }

    // -- Semantic completion provider --

    private List<Map<String, Object>> semanticCompletions(SqlCompletionSupport.SqlCompletePayload payload, String fileId, SqlCompletionSupport.SqlCompleteCursor cursor, String prefix,
            int replaceStartColumn, int maxItems, SqlParseContext context, Map<String, String> aliases)
    {
        if (context == SqlParseContext.OTHER)
        {
            return List.of();
        }

        String connectionId = resolveConnectionId(payload != null ? trimToNull(payload.connectionId())
                : null, fileId);
        if (connectionId == null)
        {
            return List.of();
        }
        String selectedDatabase = payload == null ? null
                : trimToNull(payload.database());

        recordUsage(connectionId, selectedDatabase);

        if (context == SqlParseContext.TABLE_REFERENCE)
        {
            List<JdbcSchemaNavigator.TableInfo> tableInfos = schemaNavigator.tableNamesForCompletion(connectionId, selectedDatabase);
            Set<String> seen = new HashSet<>();
            return tableInfos.stream()
                    .filter(info -> prefix.isBlank()
                            || info.name()
                                    .toLowerCase()
                                    .startsWith(prefix.toLowerCase()))
                    .filter(info -> seen.add(info.name()
                            .toLowerCase()))
                    .sorted((a, b) -> String.CASE_INSENSITIVE_ORDER.compare(a.name(), b.name()))
                    .limit(maxItems)
                    .map(info ->
                    {
                        String detail = "table".equals(info.kind()) ? "JDBC table"
                                : "JDBC view";
                        return Map.<String, Object>of("label", info.name(), "kind", info.kind(), "detail", detail, "insertText", info.name(), "insertTextFormat", "plain", "source", "jdbc.schema",
                                "replaceRange", Map.of("startLine", cursor.line(), "startColumn", replaceStartColumn, "endLine", cursor.line(), "endColumn", cursor.column()));
                    })
                    .toList();
        }

        // -- COLUMN_REFERENCE context --
        List<String> tableNames;
        List<Map<String, Object>> columnItems = new ArrayList<>();
        Set<String> seenLower = new HashSet<>();

        if (prefix.contains("."))
        {
            int dotIndex = prefix.lastIndexOf('.');
            String partialColumn = prefix.substring(dotIndex + 1);
            String qualifier = prefix.substring(0, dotIndex);
            String resolvedTable = aliases.getOrDefault(qualifier.toLowerCase(), qualifier);
            tableNames = List.of(resolvedTable);
            Map<String, List<String>> allTableColumns = schemaNavigator.columnNamesForTables(connectionId, tableNames, selectedDatabase);
            for (String col : allTableColumns.getOrDefault(resolvedTable, List.of()))
            {
                if ((partialColumn.isBlank()
                        || col.toLowerCase()
                                .startsWith(partialColumn.toLowerCase()))
                        && seenLower.add(col.toLowerCase()))
                {
                    String insertText = qualifier + "." + col;
                    columnItems.add(Map.<String, Object>of("label", insertText, "kind", "column", "detail", "JDBC column", "insertText", insertText, "insertTextFormat", "plain", "source",
                            "jdbc.schema", "replaceRange", Map.of("startLine", cursor.line(), "startColumn", replaceStartColumn, "endLine", cursor.line(), "endColumn", cursor.column())));
                }
            }
        }
        else
        {
            Map<String, String> tableToAlias = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : aliases.entrySet())
            {
                tableToAlias.put(entry.getValue(), entry.getKey());
            }
            tableNames = List.copyOf(tableToAlias.keySet());
            Map<String, List<String>> allTableColumns = schemaNavigator.columnNamesForTables(connectionId, tableNames, selectedDatabase);
            for (Map.Entry<String, List<String>> entry : allTableColumns.entrySet())
            {
                String tableName = entry.getKey();
                String alias = tableToAlias.get(tableName);
                for (String col : entry.getValue())
                {
                    String displayPrefix = (alias != null
                            && !alias.equalsIgnoreCase(tableName)) ? alias
                                    : null;
                    String prefixed = displayPrefix != null ? displayPrefix + "." + col
                            : col;
                    if ((prefix.isBlank()
                            || col.toLowerCase()
                                    .startsWith(prefix.toLowerCase()))
                            && seenLower.add(prefixed.toLowerCase()))
                    {
                        columnItems.add(Map.<String, Object>of("label", prefixed, "kind", "column", "detail", "JDBC column", "insertText", prefixed, "insertTextFormat", "plain", "source",
                                "jdbc.schema", "replaceRange", Map.of("startLine", cursor.line(), "startColumn", replaceStartColumn, "endLine", cursor.line(), "endColumn", cursor.column())));
                    }
                }
            }
        }

        return columnItems.stream()
                .sorted((a, b) -> String.CASE_INSENSITIVE_ORDER.compare(String.valueOf(a.get("label")), String.valueOf(b.get("label"))))
                .limit(maxItems)
                .toList();
    }

    // -- Semantic hover provider --

    Map<String, Object> semanticHover(SqlHoverSupport.SqlHoverPayload payload, String fileId, SqlHoverSupport.SqlHoverCursor cursor, String token, SqlParseContext context, Map<String, String> aliases)
    {
        if (context == SqlParseContext.OTHER
                || token == null)
        {
            return null;
        }

        String connectionId = resolveConnectionId(payload != null ? trimToNull(payload.connectionId())
                : null, fileId);
        if (connectionId == null)
        {
            return null;
        }
        String selectedDatabase = payload == null ? null
                : trimToNull(payload.database());

        recordUsage(connectionId, selectedDatabase);

        List<JdbcSchemaObject> snapshot = schemaNavigator.loadDeepSnapshot(connectionId);
        if (snapshot == null
                || snapshot.isEmpty())
        {
            return null;
        }

        List<Map<String, Object>> contents = new ArrayList<>();

        if (context == SqlParseContext.TABLE_REFERENCE)
        {
            String tableMarkdown = buildTableHoverMarkdown(snapshot, token, selectedDatabase);
            if (tableMarkdown == null)
            {
                return null;
            }
            contents.add(Map.of("value", tableMarkdown, "isTrusted", false));
        }
        else if (context == SqlParseContext.COLUMN_REFERENCE)
        {
            String columnMarkdown = buildColumnHoverMarkdown(snapshot, token, aliases, selectedDatabase);
            if (columnMarkdown == null)
            {
                return null;
            }
            contents.add(Map.of("value", columnMarkdown, "isTrusted", false));
        }

        if (contents.isEmpty())
        {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contents", contents);
        return result;
    }

    // -- Markdown builders --

    private static String buildTableHoverMarkdown(List<JdbcSchemaObject> snapshot, String token, String selectedDatabase)
    {
        String[] parts = token.split("\\.", 2);
        String lookupName = parts.length == 2 ? parts[1]
                : parts[0];
        String lookupSchema = parts.length == 2 ? parts[0]
                : null;

        JdbcSchemaObject tableNode = findTableInSnapshot(snapshot, lookupName, lookupSchema, selectedDatabase);
        if (tableNode == null)
        {
            return null;
        }

        String displayName = tableNode.fullName() != null ? tableNode.fullName()
                : tableNode.name();
        StringBuilder md = new StringBuilder();
        md.append("**Table: " + displayName + "**\n\n");
        md.append("| Column | Type | Nullable | Key |\n");
        md.append("|---|---|---|---|\n");

        if (tableNode.children() != null)
        {
            for (JdbcSchemaObject child : tableNode.children())
            {
                if (!"column".equalsIgnoreCase(trimToNull(child.kind())))
                {
                    continue;
                }
                Map<String, Object> attrs = child.attributes() != null ? child.attributes()
                        : Map.of();
                String colName = child.name() != null ? child.name()
                        : "";
                String type = formatType(attrs);
                String nullable = Objects.toString(attrs.get("nullable"), "");
                String key = Boolean.TRUE.equals(attrs.get("primaryKey")) ? "PK"
                        : Boolean.TRUE.equals(attrs.get("foreignKey")) ? "FK"
                                : "";
                md.append("| " + colName + " | " + type + " | " + nullable + " | " + key + " |\n");
            }
        }

        return md.toString();
    }

    private static String buildColumnHoverMarkdown(List<JdbcSchemaObject> snapshot, String token, Map<String, String> aliases, String selectedDatabase)
    {
        int dotIndex = token.lastIndexOf('.');
        String colName;
        String qualifier;

        if (dotIndex >= 0)
        {
            colName = token.substring(dotIndex + 1);
            qualifier = token.substring(0, dotIndex);
        }
        else
        {
            colName = token;
            qualifier = null;
        }

        if (isBlank(colName))
        {
            return null;
        }

        JdbcSchemaObject tableNode = null;
        String resolvedTableName = null;

        if (qualifier != null)
        {
            String tableName = aliases.getOrDefault(qualifier.toLowerCase(), qualifier);
            String[] nameParts = tableName.split("\\.", 2);
            String lookupName = nameParts.length == 2 ? nameParts[1]
                    : nameParts[0];
            String lookupSchema = nameParts.length == 2 ? nameParts[0]
                    : null;
            tableNode = findTableInSnapshot(snapshot, lookupName, lookupSchema, selectedDatabase);
            resolvedTableName = tableName;
        }
        else
        {
            for (JdbcSchemaObject candidateTable : flattenTablesInDatabase(snapshot, selectedDatabase))
            {
                if (candidateTable.children() == null)
                {
                    continue;
                }
                for (JdbcSchemaObject child : candidateTable.children())
                {
                    if ("column".equalsIgnoreCase(trimToNull(child.kind()))
                            && child.name() != null
                            && child.name()
                                    .equalsIgnoreCase(colName))
                    {
                        tableNode = candidateTable;
                        resolvedTableName = candidateTable.fullName() != null ? candidateTable.fullName()
                                : candidateTable.name();
                        break;
                    }
                }
                if (tableNode != null)
                {
                    break;
                }
            }
        }

        if (tableNode == null)
        {
            return null;
        }

        JdbcSchemaObject columnNode = null;
        if (tableNode.children() != null)
        {
            for (JdbcSchemaObject child : tableNode.children())
            {
                if ("column".equalsIgnoreCase(trimToNull(child.kind()))
                        && child.name() != null
                        && child.name()
                                .equalsIgnoreCase(colName))
                {
                    columnNode = child;
                    break;
                }
            }
        }
        if (columnNode == null)
        {
            return null;
        }

        Map<String, Object> attrs = columnNode.attributes() != null ? columnNode.attributes()
                : Map.of();
        String displayName = (resolvedTableName != null ? resolvedTableName
                : "?") + "." + columnNode.name();

        StringBuilder md = new StringBuilder();
        md.append("**Column: " + displayName + "**\n\n");
        md.append("- Type: `" + formatType(attrs) + "`\n");
        md.append("- Nullable: " + Objects.toString(attrs.get("nullable"), "N/A") + "\n");
        if (Boolean.TRUE.equals(attrs.get("primaryKey")))
        {
            md.append("- Primary Key: Yes\n");
        }
        if (Boolean.TRUE.equals(attrs.get("foreignKey")))
        {
            md.append("- Foreign Key: Yes\n");
            String refTable = Objects.toString(attrs.get("referencesTable"), null);
            String refCol = Objects.toString(attrs.get("referencesColumn"), null);
            if (refTable != null)
            {
                md.append("- References: `" + refTable
                          + (refCol != null ? "." + refCol
                                  : "")
                          + "`\n");
            }
        }

        return md.toString();
    }

    private static String formatType(Map<String, Object> attrs)
    {
        String type = Objects.toString(attrs.get("type"), "unknown");
        Object size = attrs.get("size");
        Object precision = attrs.get("precision");
        Object scale = attrs.get("scale");
        if (size instanceof Number s)
        {
            return type + "(" + s + ")";
        }
        if (precision instanceof Number p
                && scale instanceof Number s)
        {
            return type + "(" + p + "," + s + ")";
        }
        return type;
    }

    // -- Snapshot tree helpers --

    private static List<JdbcSchemaObject> flattenTablesInDatabase(List<JdbcSchemaObject> nodes, String selectedDatabase)
    {
        List<JdbcSchemaObject> tables = new ArrayList<>();
        String normalizedSelectedDb = JdbcUtils.normalizeIdentifier(selectedDatabase);
        flattenTablesRecursive(nodes, new NodePath(null, null), normalizedSelectedDb, tables);
        return tables;
    }

    private static void flattenTablesRecursive(List<JdbcSchemaObject> nodes, NodePath path, String normalizedSelectedDb, List<JdbcSchemaObject> target)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            if (kind == null)
            {
                continue;
            }

            NodePath nextPath = path;
            if (kind.endsWith("_container")
                    || kind.endsWith("_folder"))
            {
                // fall through to children recursion
            }
            else if ("database".equalsIgnoreCase(kind))
            {
                nextPath = new NodePath(node.name(), path.schema());
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = new NodePath(path.database(), node.name());
            }

            if ("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
            {
                if (normalizedSelectedDb != null
                        && nextPath.database() != null)
                {
                    String normalizedNodeDb = JdbcUtils.normalizeIdentifier(nextPath.database());
                    if (!normalizedSelectedDb.equals(normalizedNodeDb))
                    {
                        List<JdbcSchemaObject> children = node.children();
                        if (children != null
                                && !children.isEmpty())
                        {
                            flattenTablesRecursive(children, nextPath, normalizedSelectedDb, target);
                        }
                        continue;
                    }
                }
                target.add(node);
            }

            List<JdbcSchemaObject> children = node.children();
            if (children != null
                    && !children.isEmpty())
            {
                flattenTablesRecursive(children, nextPath, normalizedSelectedDb, target);
            }
        }
    }

    private static JdbcSchemaObject findTableInSnapshot(List<JdbcSchemaObject> nodes, String lookupName, String lookupSchema, String selectedDatabase)
    {
        return findTableInSnapshotRecursive(nodes, new NodePath(null, null), lookupName, lookupSchema, selectedDatabase);
    }

    private static JdbcSchemaObject findTableInSnapshotRecursive(List<JdbcSchemaObject> nodes, NodePath path, String lookupName, String lookupSchema, String selectedDatabase)
    {
        String normalizedSelectedDb = JdbcUtils.normalizeIdentifier(selectedDatabase);
        for (JdbcSchemaObject node : nodes)
        {
            String kind = trimToNull(node.kind());
            if (kind == null)
            {
                continue;
            }

            NodePath nextPath = path;
            if (kind.endsWith("_container")
                    || kind.endsWith("_folder"))
            {
                // fall through to children recursion
            }
            else if ("database".equalsIgnoreCase(kind))
            {
                nextPath = new NodePath(node.name(), path.schema());
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = new NodePath(path.database(), node.name());
            }

            if ("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
            {
                if (node.name() != null
                        && node.name()
                                .equalsIgnoreCase(lookupName))
                {
                    if (normalizedSelectedDb != null
                            && nextPath.database() != null)
                    {
                        String normalizedNodeDb = JdbcUtils.normalizeIdentifier(nextPath.database());
                        if (!normalizedSelectedDb.equals(normalizedNodeDb))
                        {
                            List<JdbcSchemaObject> children = node.children();
                            if (children != null
                                    && !children.isEmpty())
                            {
                                JdbcSchemaObject found = findTableInSnapshotRecursive(children, nextPath, lookupName, lookupSchema, selectedDatabase);
                                if (found != null)
                                {
                                    return found;
                                }
                            }
                            continue;
                        }
                    }

                    if (lookupSchema != null
                            && nextPath.schema() != null
                            && !nextPath.schema()
                                    .equalsIgnoreCase(lookupSchema))
                    {
                        List<JdbcSchemaObject> children = node.children();
                        if (children != null
                                && !children.isEmpty())
                        {
                            JdbcSchemaObject found = findTableInSnapshotRecursive(children, nextPath, lookupName, lookupSchema, selectedDatabase);
                            if (found != null)
                            {
                                return found;
                            }
                        }
                        continue;
                    }
                    return node;
                }
            }

            List<JdbcSchemaObject> children = node.children();
            if (children != null
                    && !children.isEmpty())
            {
                JdbcSchemaObject found = findTableInSnapshotRecursive(children, nextPath, lookupName, lookupSchema, selectedDatabase);
                if (found != null)
                {
                    return found;
                }
            }
        }
        return null;
    }

    private record NodePath(String database, String schema)
    {
    }

    // -- Internal helpers --

    private String resolveConnectionId(String connectionId, String fileId)
    {
        if (connectionId != null)
        {
            return connectionId;
        }
        return fileId != null ? fileToConnectionId.apply(fileId)
                : null;
    }

    private void recordUsage(String connectionId, String database)
    {
        try
        {
            usageListener.onUsage(connectionId, database);
        }
        catch (RuntimeException ignored)
        {
        }
    }

    private record SqlSymbolAtPositionPayload(String fileId, String text, SymbolCursor cursor, String connectionId, String database)
    {
    }

    private record SymbolCursor(int line, int column)
    {
    }
}
