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
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.sql.parser.SqlCompletionSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlHoverSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlParseContext;

/** Handles SQL semantic operations (completion, hover, symbol lookup) against H2 schema snapshots. */
final class JdbcSqlSemanticHandler implements JdbcSqlEditorServices
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

    Object completeInvoke(String fileId, Object payload)
    {
        return SqlCompletionSupport.complete(payloadMapper, parseSessions, engineId, fileId, payload, this::semanticCompletions);
    }

    // -- Hover --

    Object hoverInvoke(String fileId, Object payload)
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
        JdbcSqlEditorServices.Symbol symbol = symbolAtPosition(new JdbcSqlEditorServices.SymbolRequest(connectionId, selectedDatabase, params.text(), null, token, params.cursor()
                .line(),
                params.cursor()
                        .column(),
                Map.of()));
        return toSymbolMap(symbol);
    }

    @Override
    public Symbol symbolAtPosition(SymbolRequest request)
    {
        if (request == null
                || isBlank(request.token())
                || isBlank(request.connectionId()))
        {
            return null;
        }

        String connectionId = trimToNull(request.connectionId());
        String selectedDatabase = trimToNull(request.database());
        recordUsage(connectionId, selectedDatabase);
        return fromSymbolMap(schemaNavigator.findSymbol(connectionId, request.token(), selectedDatabase));
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

        return complete(new JdbcSqlEditorServices.CompletionRequest(connectionId, selectedDatabase, payload == null ? null
                : payload.text(), context.name(), prefix, replaceStartColumn, cursor.line(), cursor.column(), maxItems, aliases)).stream()
                .map(item -> toCompletionMap(item, cursor, replaceStartColumn))
                .filter(map -> !map.isEmpty())
                .toList();
    }

    @Override
    public List<CompletionItem> complete(CompletionRequest request)
    {
        if (request == null)
        {
            return List.of();
        }
        SqlParseContext context = parseContext(request.sqlContext());
        if (context == SqlParseContext.OTHER)
        {
            return List.of();
        }
        String connectionId = trimToNull(request.connectionId());
        if (connectionId == null)
        {
            return List.of();
        }
        int maxItems = Math.max(0, request.maxItems());
        if (maxItems == 0)
        {
            return List.of();
        }
        String selectedDatabase = trimToNull(request.database());
        String prefix = request.prefix() == null ? ""
                : request.prefix();
        SqlCompletionSupport.SqlCompleteCursor cursor = new SqlCompletionSupport.SqlCompleteCursor(request.line(), request.column());

        recordUsage(connectionId, selectedDatabase);

        if (context == SqlParseContext.PROCEDURE_CALL)
        {
            String text = request.text();
            String procName = null;
            boolean insideParams = isInsideProcedureParameterList(text, cursor);
            if (!insideParams)
            {
                procName = extractProcedureNameBeforeCursor(text, cursor);
            }
            else
            {
                procName = extractProcedureName(text, cursor);
            }
            if (insideParams
                    || procName != null)
            {
                if (procName == null)
                {
                    return List.of();
                }
                // Parse schema-qualified name
                String schema = null;
                String simpleName = procName;
                int dotIndex = procName.lastIndexOf('.');
                if (dotIndex >= 0)
                {
                    schema = procName.substring(0, dotIndex);
                    simpleName = procName.substring(dotIndex + 1);
                }
                List<String> paramNames = schemaNavigator.procedureParameterNames(connectionId, schema, simpleName);
                Set<String> seen = new HashSet<>();
                return paramNames.stream()
                        .filter(name -> prefix.isBlank()
                                || name.toLowerCase()
                                        .startsWith(prefix.toLowerCase()))
                        .filter(name -> seen.add(name.toLowerCase()))
                        .sorted(String.CASE_INSENSITIVE_ORDER)
                        .limit(maxItems)
                        .map(name -> new CompletionItem(name, "parameter", "JDBC procedure parameter", null, name, "plain", "jdbc.schema"))
                        .toList();
            }
            boolean explicitDatabasePrefix = qualifierPartCount(prefix) >= 3;
            List<JdbcSchemaNavigator.TableInfo> procInfos = schemaNavigator.procedureNamesForCompletion(connectionId, explicitDatabasePrefix ? null
                    : selectedDatabase);
            Set<String> seen = new HashSet<>();
            return procInfos.stream()
                    .map(info -> explicitDatabasePrefix
                            && info.database() != null ? new JdbcSchemaNavigator.TableInfo(info.database() + "." + info.name(), info.kind(), info.database())
                                    : info)
                    .filter(info -> prefix.isBlank()
                            || info.name()
                                    .toLowerCase()
                                    .startsWith(prefix.toLowerCase()))
                    .filter(info -> seen.add(info.name()
                            .toLowerCase()))
                    .sorted((a, b) -> String.CASE_INSENSITIVE_ORDER.compare(a.name(), b.name()))
                    .limit(maxItems)
                    .map(info -> new CompletionItem(info.name(), info.kind(), "JDBC procedure", null, info.name(), "plain", "jdbc.schema"))
                    .toList();
        }

        if (context == SqlParseContext.TABLE_REFERENCE)
        {
            boolean explicitDatabasePrefix = qualifierPartCount(prefix) >= 3;
            List<JdbcSchemaNavigator.TableInfo> tableInfos = schemaNavigator.tableNamesForCompletion(connectionId, explicitDatabasePrefix ? null
                    : selectedDatabase);
            Set<String> seen = new HashSet<>();
            return tableInfos.stream()
                    .map(info -> explicitDatabasePrefix
                            && info.database() != null ? new JdbcSchemaNavigator.TableInfo(info.database() + "." + info.name(), info.kind(), info.database())
                                    : info)
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
                        return new CompletionItem(info.name(), info.kind(), detail, null, info.name(), "plain", "jdbc.schema");
                    })
                    .toList();
        }

        // -- COLUMN_REFERENCE context --
        List<String> tableNames;
        List<CompletionItem> columnItems = new ArrayList<>();
        Set<String> seenLower = new HashSet<>();
        Map<String, String> aliases = request.aliases() == null ? Map.of()
                : request.aliases();

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
                    columnItems.add(new CompletionItem(insertText, "column", "JDBC column", null, insertText, "plain", "jdbc.schema"));
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
                        columnItems.add(new CompletionItem(prefixed, "column", "JDBC column", null, prefixed, "plain", "jdbc.schema"));
                    }
                }
            }
        }

        return columnItems.stream()
                .sorted((a, b) -> String.CASE_INSENSITIVE_ORDER.compare(a.label(), b.label()))
                .limit(maxItems)
                .toList();
    }

    // -- Procedure call helpers --

    private static boolean isInsideProcedureParameterList(String text, SqlCompletionSupport.SqlCompleteCursor cursor)
    {
        if (text == null
                || cursor == null)
        {
            return false;
        }
        String[] lines = text.split("\\R", -1);
        if (cursor.line() > lines.length)
        {
            return false;
        }
        String line = lines[cursor.line() - 1];
        int col0 = Math.min(cursor.column() - 1, line.length());
        String prefix = line.substring(0, col0);
        int lastParen = prefix.lastIndexOf('(');
        if (lastParen < 0)
        {
            return false;
        }
        // Verify there's a word before the paren (the procedure name)
        String beforeParen = prefix.substring(0, lastParen)
                .trim();
        if (beforeParen.isEmpty())
        {
            return false;
        }
        int lastWordStart = beforeParen.length() - 1;
        while (lastWordStart >= 0
                && !Character.isWhitespace(beforeParen.charAt(lastWordStart))
                && beforeParen.charAt(lastWordStart) != ',')
        {
            lastWordStart--;
        }
        String wordBeforeParen = beforeParen.substring(lastWordStart + 1)
                .trim();
        return !wordBeforeParen.isEmpty()
                && Character.isLetter(wordBeforeParen.charAt(0));
    }

    private static String extractProcedureName(String text, SqlCompletionSupport.SqlCompleteCursor cursor)
    {
        if (text == null
                || cursor == null)
        {
            return null;
        }
        String[] lines = text.split("\\R", -1);
        if (cursor.line() > lines.length)
        {
            return null;
        }
        String line = lines[cursor.line() - 1];
        int col0 = Math.min(cursor.column() - 1, line.length());
        String prefix = line.substring(0, col0);
        int lastParen = prefix.lastIndexOf('(');
        if (lastParen < 0)
        {
            return null;
        }
        String beforeParen = prefix.substring(0, lastParen)
                .trim();
        if (beforeParen.isEmpty())
        {
            return null;
        }
        int end = beforeParen.length();
        int start = end - 1;
        while (start >= 0
                && (Character.isLetterOrDigit(beforeParen.charAt(start))
                        || beforeParen.charAt(start) == '_'
                        || beforeParen.charAt(start) == '.'))
        {
            start--;
        }
        if (start == end - 1)
        {
            return null;
        }
        return beforeParen.substring(start + 1);
    }

    /**
     * Returns the procedure name after CALL/EXEC when the cursor is past the procedure name but no '(' has been opened. Returns null if no completed procedure name is found.
     */
    static String extractProcedureNameBeforeCursor(String text, SqlCompletionSupport.SqlCompleteCursor cursor)
    {
        if (text == null
                || cursor == null)
        {
            return null;
        }
        String[] lines = text.split("\\R", -1);
        if (cursor.line() > lines.length)
        {
            return null;
        }
        String line = lines[cursor.line() - 1];
        int col0 = Math.min(cursor.column(), line.length());
        // If cursor is on a word char, the procedure name is still being typed — let procedure name completion handle it
        if (col0 > 0
                && (Character.isLetterOrDigit(line.charAt(col0 - 1))
                        || line.charAt(col0 - 1) == '_'
                        || line.charAt(col0 - 1) == '.'))
        {
            return null;
        }
        String prefix = line.substring(0, col0)
                .trim();
        // Find the last CALL/EXEC keyword before cursor
        int keywordIdx = -1;
        String lower = prefix.toLowerCase();
        int idx;
        idx = lower.lastIndexOf("call ");
        if (idx >= 0)
        {
            keywordIdx = idx;
        }
        idx = lower.lastIndexOf("exec ");
        if (idx >= 0
                && idx > keywordIdx)
        {
            keywordIdx = idx;
        }
        if (keywordIdx < 0)
        {
            return null;
        }
        String afterKeyword = prefix.substring(keywordIdx + 5)
                .trim();
        if (afterKeyword.isEmpty())
        {
            return null;
        }
        String[] parts = afterKeyword.split("\\s+", 2);
        String name = parts[0];
        // Strip trailing non-name characters (e.g. '(')
        int end = name.length();
        while (end > 0
                && !Character.isLetterOrDigit(name.charAt(end - 1))
                && name.charAt(end - 1) != '_')
        {
            end--;
        }
        return end > 0 ? name.substring(0, end)
                : null;
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

        JdbcSqlEditorServices.Hover hover = hover(new JdbcSqlEditorServices.HoverRequest(connectionId, selectedDatabase, payload == null ? null
                : payload.text(), context.name(), token, cursor.line(), cursor.column(), aliases));
        if (hover == null
                || isBlank(hover.markdown()))
        {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contents", List.of(Map.of("value", hover.markdown(), "isTrusted", false)));
        return result;
    }

    @Override
    public Hover hover(HoverRequest request)
    {
        if (request == null
                || isBlank(request.token())
                || isBlank(request.connectionId()))
        {
            return null;
        }
        SqlParseContext context = parseContext(request.sqlContext());
        if (context == SqlParseContext.OTHER)
        {
            return null;
        }

        String connectionId = trimToNull(request.connectionId());
        String selectedDatabase = trimToNull(request.database());
        Map<String, String> aliases = request.aliases() == null ? Map.of()
                : request.aliases();
        String token = request.token();
        recordUsage(connectionId, selectedDatabase);

        String markdown = null;

        if (context == SqlParseContext.TABLE_REFERENCE)
        {
            markdown = buildTableHoverMarkdown(connectionId, token, aliases, selectedDatabase);
        }
        else if (context == SqlParseContext.PROCEDURE_CALL)
        {
            markdown = buildProcedureHoverMarkdown(connectionId, token, aliases, selectedDatabase);
        }
        else if (context == SqlParseContext.COLUMN_REFERENCE)
        {
            markdown = buildColumnHoverMarkdown(connectionId, token, aliases, selectedDatabase);
        }

        return isBlank(markdown) ? null
                : new Hover(markdown);
    }

    // -- Markdown builders --

    private String buildTableHoverMarkdown(String connectionId, String token, Map<String, String> aliases, String selectedDatabase)
    {
        String tableName = aliases.getOrDefault(token.toLowerCase(), token);
        JdbcSchemaNavigator.ObjectDetail tableDetail = schemaNavigator.tableDetail(connectionId, tableName, selectedDatabase);
        if (tableDetail == null)
        {
            return null;
        }
        String displayName = objectDisplayName(tableDetail, tableName);
        StringBuilder md = new StringBuilder();
        md.append("**Table: " + displayName + "**\n\n");
        md.append("| Column | Type | Nullable | Key |\n");
        md.append("|---|---|---|---|\n");

        for (JdbcSchemaObject child : tableColumns(tableDetail.object()))
        {
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

        return md.toString();
    }

    private String buildProcedureHoverMarkdown(String connectionId, String token, Map<String, String> aliases, String selectedDatabase)
    {
        String procName = aliases.getOrDefault(token.toLowerCase(), token);
        JdbcSchemaNavigator.ObjectDetail procDetail = schemaNavigator.procedureDetail(connectionId, procName, selectedDatabase);
        if (procDetail == null)
        {
            return null;
        }
        JdbcSchemaObject procNode = procDetail.object();
        String displayName = objectDisplayName(procDetail, procName);
        StringBuilder md = new StringBuilder();
        md.append("**Procedure: " + displayName + "**\n\n");
        List<JdbcSchemaObject> params = procedureParameters(procNode);
        if (!params.isEmpty())
        {
            md.append("| Parameter | Type | Mode |\n");
            md.append("|---|---|---|\n");
            for (JdbcSchemaObject param : params)
            {
                Map<String, Object> attrs = param.attributes() != null ? param.attributes()
                        : Map.of();
                String paramName = param.name() != null ? param.name()
                        : "";
                String paramType = Objects.toString(attrs.get("type"), "unknown");
                String paramMode = Objects.toString(attrs.get("mode"), "IN");
                md.append("| " + paramName + " | " + paramType + " | " + paramMode + " |\n");
            }
        }
        else
        {
            md.append("*No parameters defined*\n");
        }
        return md.toString();
    }

    private static List<JdbcSchemaObject> procedureParameters(JdbcSchemaObject procNode)
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        List<JdbcSchemaObject> children = procNode.children();
        if (children == null)
        {
            return result;
        }
        for (JdbcSchemaObject child : children)
        {
            String kind = trimToNull(child.kind());
            if ("parameter".equalsIgnoreCase(kind))
            {
                result.add(child);
            }
            else if ("parameters_folder".equalsIgnoreCase(kind)
                    && child.children() != null)
            {
                for (JdbcSchemaObject folderChild : child.children())
                {
                    if ("parameter".equalsIgnoreCase(trimToNull(folderChild.kind())))
                    {
                        result.add(folderChild);
                    }
                }
            }
        }
        return result;
    }

    private String buildColumnHoverMarkdown(String connectionId, String token, Map<String, String> aliases, String selectedDatabase)
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
            JdbcSchemaNavigator.ObjectDetail tableDetail = schemaNavigator.tableDetail(connectionId, tableName, selectedDatabase);
            tableNode = tableDetail != null ? tableDetail.object()
                    : null;
            resolvedTableName = tableDetail != null ? objectDisplayName(tableDetail, tableName)
                    : null;
        }
        else
        {
            if (aliases.isEmpty())
            {
                JdbcSchemaNavigator.ColumnDetail columnDetail = schemaNavigator.columnDetail(connectionId, colName, selectedDatabase);
                if (columnDetail == null)
                {
                    return null;
                }
                Map<String, Object> attrs = columnDetail.column()
                        .attributes() != null ? columnDetail.column()
                                .attributes()
                                : Map.of();
                return buildColumnMarkdown(displayColumnName(columnDetail), columnDetail.column(), attrs);
            }

            Map<String, String> tableToAlias = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : aliases.entrySet())
            {
                tableToAlias.putIfAbsent(entry.getValue(), entry.getKey());
            }

            for (String tableName : tableToAlias.keySet())
            {
                JdbcSchemaNavigator.ObjectDetail tableDetail = schemaNavigator.tableDetail(connectionId, tableName, selectedDatabase);
                if (tableDetail == null)
                {
                    continue;
                }
                JdbcSchemaObject candidateTable = tableDetail.object();
                for (JdbcSchemaObject child : tableColumns(candidateTable))
                {
                    if (child.name() != null
                            && child.name()
                                    .equalsIgnoreCase(colName))
                    {
                        tableNode = candidateTable;
                        resolvedTableName = objectDisplayName(tableDetail, tableName);
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
        for (JdbcSchemaObject child : tableColumns(tableNode))
        {
            if (child.name() != null
                    && child.name()
                            .equalsIgnoreCase(colName))
            {
                columnNode = child;
                break;
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

        return buildColumnMarkdown(displayName, columnNode, attrs);
    }

    private static String buildColumnMarkdown(String displayName, JdbcSchemaObject columnNode, Map<String, Object> attrs)
    {
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

    private static String objectDisplayName(JdbcSchemaNavigator.ObjectDetail detail, String fallback)
    {
        JdbcSchemaObject object = detail.object();
        if (object.fullName() != null
                && !object.fullName()
                        .equals(object.name()))
        {
            return object.fullName();
        }
        return displayFullName(detail.database(), detail.schema(), object.name(), fallback);
    }

    private static String displayColumnName(JdbcSchemaNavigator.ColumnDetail detail)
    {
        String tableName = displayFullName(detail.database(), detail.schema(), detail.tableName(), detail.tableName());
        return tableName + "."
               + detail.column()
                       .name();
    }

    private static String displayFullName(String database, String schema, String name, String fallback)
    {
        if (name == null
                || name.isBlank())
        {
            return fallback;
        }
        if (database != null
                && !database.isBlank()
                && schema != null
                && !schema.isBlank())
        {
            return database + "." + schema + "." + name;
        }
        if (schema != null
                && !schema.isBlank())
        {
            return schema + "." + name;
        }
        return fallback;
    }

    private static int qualifierPartCount(String value)
    {
        if (isBlank(value))
        {
            return 0;
        }
        int count = 1;
        for (int i = 0; i < value.length(); i++)
        {
            if (value.charAt(i) == '.')
            {
                count++;
            }
        }
        return count;
    }

    private static List<JdbcSchemaObject> tableColumns(JdbcSchemaObject tableNode)
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        List<JdbcSchemaObject> children = tableNode.children();
        if (children == null)
        {
            return result;
        }
        for (JdbcSchemaObject child : children)
        {
            String kind = trimToNull(child.kind());
            if ("column".equalsIgnoreCase(kind))
            {
                result.add(child);
            }
            else if ("columns_folder".equalsIgnoreCase(kind)
                    && child.children() != null)
            {
                for (JdbcSchemaObject folderChild : child.children())
                {
                    if ("column".equalsIgnoreCase(trimToNull(folderChild.kind())))
                    {
                        result.add(folderChild);
                    }
                }
            }
        }
        return result;
    }

    private static Map<String, Object> toCompletionMap(JdbcSqlEditorServices.CompletionItem item, SqlCompletionSupport.SqlCompleteCursor cursor, int replaceStartColumn)
    {
        if (item == null
                || isBlank(item.label()))
        {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("label", item.label());
        putIfNotBlank(result, "kind", item.kind());
        putIfNotBlank(result, "detail", item.detail());
        putIfNotBlank(result, "documentation", item.documentation());
        putIfNotBlank(result, "insertText", item.insertText());
        putIfNotBlank(result, "insertTextFormat", item.insertTextFormat());
        putIfNotBlank(result, "source", item.source());
        result.put("replaceRange", Map.of("startLine", cursor.line(), "startColumn", replaceStartColumn, "endLine", cursor.line(), "endColumn", cursor.column()));
        return result;
    }

    private static Map<String, Object> toSymbolMap(JdbcSqlEditorServices.Symbol symbol)
    {
        if (symbol == null
                || isBlank(symbol.kind())
                || isBlank(symbol.name()))
        {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kind", symbol.kind());
        result.put("name", symbol.name());
        putIfNotBlank(result, "fullName", symbol.fullName());
        putIfNotBlank(result, "detail", symbol.detail());
        if (symbol.attributes() != null
                && !symbol.attributes()
                        .isEmpty())
        {
            result.put("attributes", symbol.attributes());
        }
        return result;
    }

    private static JdbcSqlEditorServices.Symbol fromSymbolMap(Map<String, Object> map)
    {
        if (map == null
                || isBlank(Objects.toString(map.get("kind"), null))
                || isBlank(Objects.toString(map.get("name"), null)))
        {
            return null;
        }
        Map<String, Object> attributes = new LinkedHashMap<>();
        Object rawAttributes = map.get("attributes");
        if (rawAttributes instanceof Map<?, ?> rawMap)
        {
            for (Map.Entry<?, ?> entry : rawMap.entrySet())
            {
                if (entry.getKey() instanceof String key)
                {
                    attributes.put(key, entry.getValue());
                }
            }
        }
        return new JdbcSqlEditorServices.Symbol(Objects.toString(map.get("kind"), null), Objects.toString(map.get("name"), null), Objects.toString(map.get("fullName"), null),
                Objects.toString(map.get("detail"), null), attributes.isEmpty() ? null
                        : Map.copyOf(attributes));
    }

    private static SqlParseContext parseContext(String value)
    {
        if (isBlank(value))
        {
            return SqlParseContext.OTHER;
        }
        try
        {
            return SqlParseContext.valueOf(value);
        }
        catch (IllegalArgumentException e)
        {
            return SqlParseContext.OTHER;
        }
    }

    private static void putIfNotBlank(Map<String, Object> target, String key, String value)
    {
        if (!isBlank(value))
        {
            target.put(key, value);
        }
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
