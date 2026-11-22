package com.queryeer.backend.queryengine.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices.normalizeAliases;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.regex.Pattern;

import se.kuseman.payloadbuilder.api.QualifiedName;
import se.kuseman.payloadbuilder.api.catalog.DatasourceData;
import se.kuseman.payloadbuilder.api.catalog.IDatasource;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.TupleIterator;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.ValueVector;

/**
 * Generic opt-in SQL editor services backed by Payloadbuilder catalog system tables, and optionally a provider's own per-table column lookup. Reached through
 * {@link PayloadbuilderCatalogSqlEditorServices#systemTables()} and {@link PayloadbuilderCatalogSqlEditorServices#systemTables(TableColumns)}.
 */
final class PayloadbuilderSystemTableSqlEditorServices implements PayloadbuilderCatalogSqlEditorServices
{
    static final PayloadbuilderSystemTableSqlEditorServices INSTANCE = new PayloadbuilderSystemTableSqlEditorServices(null);

    private static final String CONTEXT_TABLE_REFERENCE = "TABLE_REFERENCE";
    private static final String CONTEXT_COLUMN_REFERENCE = "COLUMN_REFERENCE";
    private static final String CONTEXT_PROCEDURE_CALL = "PROCEDURE_CALL";
    private static final String SYSTEM_TABLES = "tables";
    private static final String SYSTEM_COLUMNS = "columns";
    private static final String COLUMN_TABLE = "table";
    private static final String COLUMN_NAME = "name";
    private static final String COLUMN_TYPE = "type";
    private static final String FUNCTION_TYPE_TABLE = "TABLE";
    private static final Pattern SIMPLE_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final Pattern QUOTED_IDENTIFIER = Pattern.compile("\"(?:\"\"|[^\"])*\"");
    private static final int MAX_METADATA_ROWS = 5_000;
    private static final long CACHE_TTL_MS = 30_000;

    private final ConcurrentMap<MetadataKey, CachedMetadata> metadataCache = new ConcurrentHashMap<>();
    /** Null when the provider looks up no columns of its own. */
    private final TableColumns tableColumns;
    private final ConcurrentMap<TableColumnsKey, CachedColumns> tableColumnsCache = new ConcurrentHashMap<>();

    PayloadbuilderSystemTableSqlEditorServices(TableColumns tableColumns)
    {
        this.tableColumns = tableColumns;
    }

    @Override
    public List<CompletionItem> complete(CompletionRequest request)
    {
        Metadata metadata = metadata(request);
        String context = request.sqlContext();
        if (CONTEXT_COLUMN_REFERENCE.equals(context))
        {
            return completeColumns(request, metadata);
        }
        if (CONTEXT_TABLE_REFERENCE.equals(context))
        {
            List<CompletionItem> result = new ArrayList<>();
            result.addAll(completeTables(request, metadata));
            result.addAll(completeFunctions(request, metadata, true));
            return limitDistinct(result, request.maxItems());
        }
        if (CONTEXT_PROCEDURE_CALL.equals(context))
        {
            return completeFunctions(request, metadata, false);
        }
        return List.of();
    }

    @Override
    public Hover hover(HoverRequest request)
    {
        Metadata metadata = metadata(request);
        String context = request.sqlContext();
        if (CONTEXT_COLUMN_REFERENCE.equals(context))
        {
            ColumnMatch column = resolveColumn(request, metadata);
            if (column != null)
            {
                return new Hover(columnMarkdown(request, column));
            }
        }
        TableEntry table = resolveTable(request, metadata);
        if (table != null)
        {
            return new Hover(tableMarkdown(request, metadata, table));
        }
        FunctionEntry function = resolveFunction(request, metadata);
        return function == null ? null
                : new Hover(functionMarkdown(request, function));
    }

    @Override
    public Symbol symbolAtPosition(SymbolRequest request)
    {
        Metadata metadata = metadata(request);
        if (CONTEXT_COLUMN_REFERENCE.equals(request.sqlContext()))
        {
            ColumnMatch column = resolveColumn(request, metadata);
            if (column != null)
            {
                return new Symbol("column", column.displayName(), column.displayName(), "Payloadbuilder column",
                        Map.of("catalogAlias", request.catalogAlias(), "table", column.tableName(), "name", column.column()
                                .name()));
            }
        }
        TableEntry table = resolveTable(request, metadata);
        if (table != null)
        {
            String name = tableDisplayName(request, table.name());
            return new Symbol("table", name, name, "Payloadbuilder table", Map.of("catalogAlias", request.catalogAlias(), "name", table.name()));
        }
        FunctionEntry function = resolveFunction(request, metadata);
        if (function != null)
        {
            String name = functionDisplayName(request, function.name());
            return new Symbol("function", name, name, "Payloadbuilder function", Map.of("catalogAlias", request.catalogAlias(), "name", function.name(), "functionType", function.type()));
        }
        return null;
    }

    private List<CompletionItem> completeTables(CompletionRequest request, Metadata metadata)
    {
        return metadata.tables()
                .stream()
                .map(table -> tableCompletionItem(request, table))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(CompletionItem::label, String.CASE_INSENSITIVE_ORDER))
                .limit(request.maxItems())
                .toList();
    }

    private CompletionItem tableCompletionItem(CompletionRequest request, TableEntry table)
    {
        String label = completionDisplayName(request, table.name(), normalizedAliases(request.aliases()));
        if (label == null)
        {
            return null;
        }
        return new CompletionItem(label, "table", "Payloadbuilder table", null, quoteInvalidIdentifierParts(label), "plain", source(request));
    }

    private List<CompletionItem> completeFunctions(CompletionRequest request, Metadata metadata, boolean tableFunctionsOnly)
    {
        return metadata.functions()
                .stream()
                .filter(function -> !tableFunctionsOnly
                        || FUNCTION_TYPE_TABLE.equalsIgnoreCase(function.type()))
                .map(function -> functionCompletionItem(request, function))
                .filter(Objects::nonNull)
                .sorted(Comparator.comparing(CompletionItem::label, String.CASE_INSENSITIVE_ORDER))
                .limit(request.maxItems())
                .toList();
    }

    private CompletionItem functionCompletionItem(CompletionRequest request, FunctionEntry function)
    {
        String label = completionDisplayName(request, function.name(), normalizedAliases(request.aliases()));
        if (label == null)
        {
            return null;
        }
        String detail = "Payloadbuilder " + function.type()
                .toLowerCase(Locale.ROOT) + " function";
        String insertText = label + "(${1})";
        return new CompletionItem(label, "function", detail, blankToNull(function.description()), insertText, "snippet", source(request));
    }

    private List<CompletionItem> completeColumns(CompletionRequest request, Metadata metadata)
    {
        List<ColumnMatch> matches = resolveColumnCompletionCandidates(request, metadata);
        return matches.stream()
                .map(column -> new CompletionItem(column.displayName(), "column", "Payloadbuilder column", blankToNull(column.column()
                        .detail()), quoteInvalidIdentifierParts(column.displayName()), "plain", source(request)))
                .sorted(Comparator.comparing(CompletionItem::label, String.CASE_INSENSITIVE_ORDER))
                .limit(request.maxItems())
                .toList();
    }

    private List<ColumnMatch> resolveColumnCompletionCandidates(CompletionRequest request, Metadata metadata)
    {
        String prefix = request.prefix() == null ? ""
                : request.prefix();
        Map<String, String> aliases = normalizedAliases(request.aliases());
        int dotIndex = qualifierEnd(request.catalogAlias(), request.defaultCatalogAlias(), aliases, prefix, metadata);
        List<ColumnMatch> result = new ArrayList<>();
        if (dotIndex >= 0)
        {
            String qualifier = prefix.substring(0, dotIndex);
            if (qualifier.equalsIgnoreCase(request.catalogAlias())
                    && !hasExplicitCatalogAlias(request.text(), request.catalogAlias()))
            {
                return List.of();
            }
            String tableName = qualifierTable(request.catalogAlias(), request.defaultCatalogAlias(), aliases, qualifier, metadata);
            if (tableName == null)
            {
                return List.of();
            }
            String partialColumn = prefix.substring(dotIndex + 1);
            for (ColumnEntry column : columnsForTable(metadata, tableName))
            {
                if (startsWithIgnoreCase(column.name(), partialColumn))
                {
                    result.add(new ColumnMatch(tableName, column, qualifier + "." + column.name()));
                }
            }
            return result;
        }

        Map<String, String> tableToAlias = tableAliasesForCatalog(request, metadata);
        for (Map.Entry<String, String> entry : tableToAlias.entrySet())
        {
            for (ColumnEntry column : columnsForTable(metadata, entry.getKey()))
            {
                if (!startsWithIgnoreCase(column.name(), prefix))
                {
                    continue;
                }
                String alias = entry.getValue();
                String displayName = alias.equalsIgnoreCase(entry.getKey()) ? column.name()
                        : alias + "." + column.name();
                result.add(new ColumnMatch(entry.getKey(), column, displayName));
            }
        }
        return distinctColumns(result);
    }

    private ColumnMatch resolveColumn(HoverRequest request, Metadata metadata)
    {
        return resolveColumn(request.catalogAlias(), request.defaultCatalogAlias(), request.aliases(), request.token(), metadata, request.text());
    }

    private ColumnMatch resolveColumn(SymbolRequest request, Metadata metadata)
    {
        return resolveColumn(request.catalogAlias(), request.defaultCatalogAlias(), request.aliases(), request.token(), metadata, request.text());
    }

    private ColumnMatch resolveColumn(String catalogAlias, String defaultCatalogAlias, Map<String, String> aliases, String token, Metadata metadata, String text)
    {
        boolean explicitCatalogAlias = hasExplicitCatalogAlias(text, catalogAlias);
        aliases = normalizedAliases(aliases);
        if (isBlank(token))
        {
            return null;
        }
        int dotIndex = qualifierEnd(catalogAlias, defaultCatalogAlias, aliases, token, metadata);
        String qualifier = dotIndex >= 0 ? token.substring(0, dotIndex)
                : null;
        String columnName = dotIndex >= 0 ? token.substring(dotIndex + 1)
                : token;
        if (qualifier != null
                && qualifier.equalsIgnoreCase(catalogAlias)
                && !explicitCatalogAlias)
        {
            qualifier = null;
        }
        if (isBlank(columnName))
        {
            return null;
        }

        if (qualifier != null)
        {
            String tableName = qualifierTable(catalogAlias, defaultCatalogAlias, aliases, qualifier, metadata);
            if (tableName == null)
            {
                return null;
            }
            ColumnEntry column = findColumn(metadata, tableName, columnName);
            return column == null ? null
                    : new ColumnMatch(tableName, column, qualifier + "." + column.name());
        }

        ColumnMatch match = null;
        for (Map.Entry<String, String> entry : tableAliasesForCatalog(catalogAlias, defaultCatalogAlias, aliases, metadata, text).entrySet())
        {
            String tableName = entry.getKey();
            ColumnEntry column = findColumn(metadata, tableName, columnName);
            if (column == null)
            {
                continue;
            }
            if (match != null)
            {
                return null;
            }
            match = new ColumnMatch(tableName, column, columnDisplayName(entry, column));
        }
        return match;
    }

    /** The table a column qualifier names, as typed in the editor; null when it names none. */
    private static String qualifierTable(String catalogAlias, String defaultCatalogAlias, Map<String, String> aliases, String qualifier, Metadata metadata)
    {
        // First try: qualifier is an actual table name in metadata (guards against
        // incorrect TreeSitter aliases for catalog#table references where the real
        // table name is mistaken for an alias).
        String tableName = tableNameInMetadata(metadata, qualifier);
        if (tableName == null)
        {
            // Fallback: qualifier may be a user-defined alias (aliases are already normalized)
            tableName = resolveTableNameCandidate(catalogAlias, defaultCatalogAlias, aliasTargetOrName(aliases, qualifier), metadata);
        }
        return tableName;
    }

    /**
     * Where the qualifier of a dotted column reference ends: at the last dot, unless only a shorter qualifier names a listed table. So {@code p.payload.orderId} is the column {@code payload.orderId}
     * of {@code p}'s table, as a catalog that looks up nested fields lists it. -1 without a dot.
     */
    private static int qualifierEnd(String catalogAlias, String defaultCatalogAlias, Map<String, String> aliases, String token, Metadata metadata)
    {
        int last = token.lastIndexOf('.');
        for (int i = last; i > 0; i = token.lastIndexOf('.', i - 1))
        {
            String tableName = qualifierTable(catalogAlias, defaultCatalogAlias, aliases, token.substring(0, i), metadata);
            if (tableName != null
                    && hasTable(metadata, tableName))
            {
                return i;
            }
        }
        return last;
    }

    private TableEntry resolveTable(HoverRequest request, Metadata metadata)
    {
        return resolveTable(request.catalogAlias(), request.defaultCatalogAlias(), request.aliases(), request.token(), metadata);
    }

    private TableEntry resolveTable(SymbolRequest request, Metadata metadata)
    {
        return resolveTable(request.catalogAlias(), request.defaultCatalogAlias(), request.aliases(), request.token(), metadata);
    }

    private TableEntry resolveTable(String catalogAlias, String defaultCatalogAlias, Map<String, String> aliases, String token, Metadata metadata)
    {
        // First try: token is an actual table name in metadata — this guards against
        // incorrect aliases produced by TreeSitter when it parses catalog#table
        // (e.g. "es#_doc") as two separate identifiers, treating the real table name
        // as an implicit alias.
        String tokenTableName = tableNameInMetadata(metadata, token);
        if (tokenTableName != null)
        {
            String resolvedTableName = tokenTableName;
            return metadata.tables()
                    .stream()
                    .filter(t -> t.name()
                            .equalsIgnoreCase(resolvedTableName))
                    .findFirst()
                    .orElse(null);
        }

        // Fallback: token may be a user-defined alias → resolve through aliases map
        aliases = normalizedAliases(aliases);
        String resolved = aliasTargetOrName(aliases, token);
        String tableName = resolveTableNameCandidate(catalogAlias, defaultCatalogAlias, resolved, metadata);
        if (tableName == null)
        {
            return null;
        }
        String resolvedTableName = tableName;
        return metadata.tables()
                .stream()
                .filter(table -> table.name()
                        .equalsIgnoreCase(resolvedTableName))
                .findFirst()
                .orElse(null);
    }

    private FunctionEntry resolveFunction(HoverRequest request, Metadata metadata)
    {
        return resolveFunction(request.catalogAlias(), request.defaultCatalogAlias(), request.token(), metadata);
    }

    private FunctionEntry resolveFunction(SymbolRequest request, Metadata metadata)
    {
        return resolveFunction(request.catalogAlias(), request.defaultCatalogAlias(), request.token(), metadata);
    }

    private FunctionEntry resolveFunction(String catalogAlias, String defaultCatalogAlias, String token, Metadata metadata)
    {
        String functionName = resolveTableNameForCatalog(catalogAlias, defaultCatalogAlias, token);
        if (functionName == null)
        {
            return null;
        }
        return metadata.functions()
                .stream()
                .filter(function -> function.name()
                        .equalsIgnoreCase(functionName))
                .findFirst()
                .orElse(null);
    }

    private Metadata metadata(CompletionRequest request)
    {
        MetadataKey key = new MetadataKey(request.catalogAlias(), request.catalogId(), request.catalog(), request.properties());
        return new Metadata(catalogMetadata(key, request), key, request.session(), request.executionContext());
    }

    private Metadata metadata(HoverRequest request)
    {
        MetadataKey key = new MetadataKey(request.catalogAlias(), request.catalogId(), request.catalog(), request.properties());
        return new Metadata(catalogMetadata(key, request), key, request.session(), request.executionContext());
    }

    private Metadata metadata(SymbolRequest request)
    {
        MetadataKey key = new MetadataKey(request.catalogAlias(), request.catalogId(), request.catalog(), request.properties());
        return new Metadata(catalogMetadata(key, request), key, request.session(), request.executionContext());
    }

    private CatalogMetadata catalogMetadata(MetadataKey key, Object request)
    {
        long now = System.currentTimeMillis();
        CachedMetadata cached = metadataCache.get(key);
        if (cached != null
                && now - cached.createdAtMs() <= CACHE_TTL_MS)
        {
            return cached.metadata();
        }

        CatalogMetadata metadata;
        if (request instanceof CompletionRequest r)
        {
            metadata = buildMetadata(r);
        }
        else if (request instanceof HoverRequest r)
        {
            metadata = buildMetadata(r);
        }
        else if (request instanceof SymbolRequest r)
        {
            metadata = buildMetadata(r);
        }
        else
        {
            metadata = CatalogMetadata.EMPTY;
        }
        // Drop what expired, so aliases and property values that are no longer used don't stay
        metadataCache.values()
                .removeIf(entry -> now - entry.createdAtMs() > CACHE_TTL_MS);
        metadataCache.put(key, new CachedMetadata(metadata, now));
        return metadata;
    }

    private CatalogMetadata buildMetadata(CompletionRequest request)
    {
        return buildMetadata(request.catalogAlias(), request.catalog(), request.session(), request.executionContext());
    }

    private CatalogMetadata buildMetadata(HoverRequest request)
    {
        return buildMetadata(request.catalogAlias(), request.catalog(), request.session(), request.executionContext());
    }

    private CatalogMetadata buildMetadata(SymbolRequest request)
    {
        return buildMetadata(request.catalogAlias(), request.catalog(), request.session(), request.executionContext());
    }

    private CatalogMetadata buildMetadata(String catalogAlias, se.kuseman.payloadbuilder.api.catalog.Catalog catalog, se.kuseman.payloadbuilder.api.execution.IQuerySession session,
            se.kuseman.payloadbuilder.api.execution.IExecutionContext executionContext)
    {
        List<FunctionEntry> functions = catalog.getFunctions()
                .stream()
                .map(function -> new FunctionEntry(function.getName(), function.getFunctionType()
                        .name(), function.getDescription()))
                .toList();

        List<TableEntry> tables = readSystemRows(catalogAlias, catalog, session, executionContext, SYSTEM_TABLES).stream()
                .map(row -> stringValue(row.get(COLUMN_NAME)))
                .filter(Objects::nonNull)
                .distinct()
                .map(TableEntry::new)
                .toList();

        List<ColumnEntry> columns = readSystemRows(catalogAlias, catalog, session, executionContext, SYSTEM_COLUMNS).stream()
                .map(row ->
                {
                    String table = stringValue(row.get(COLUMN_TABLE));
                    String name = stringValue(row.get(COLUMN_NAME));
                    if (isBlank(table)
                            || isBlank(name))
                    {
                        return null;
                    }
                    return new ColumnEntry(table, name, stringValue(row.get(COLUMN_TYPE)), null);
                })
                .filter(Objects::nonNull)
                .toList();
        return new CatalogMetadata(tables, columns, functions);
    }

    private List<Map<String, Object>> readSystemRows(String catalogAlias, se.kuseman.payloadbuilder.api.catalog.Catalog catalog, se.kuseman.payloadbuilder.api.execution.IQuerySession session,
            se.kuseman.payloadbuilder.api.execution.IExecutionContext executionContext, String table)
    {
        try
        {
            catalog.getSystemTableSchema(session, catalogAlias, QualifiedName.of(table));
            DatasourceData data = new DatasourceData(-1, new ArrayList<>(), List.of(), DatasourceData.Projection.ALL, List.of());
            IDatasource datasource = catalog.getSystemTableDataSource(session, catalogAlias, QualifiedName.of(table), data);
            TupleIterator iterator = datasource.execute(executionContext);
            try
            {
                List<Map<String, Object>> rows = new ArrayList<>();
                while (iterator.hasNext()
                        && rows.size() < MAX_METADATA_ROWS)
                {
                    TupleVector vector = iterator.next();
                    Schema schema = vector.getSchema();
                    for (int row = 0; row < vector.getRowCount()
                            && rows.size() < MAX_METADATA_ROWS; row++)
                    {
                        Map<String, Object> values = new LinkedHashMap<>();
                        for (int col = 0; col < schema.getSize(); col++)
                        {
                            // Only ever read as text (stringValue): table, column and type names
                            ValueVector column = vector.getColumn(col);
                            values.put(schema.getColumns()
                                    .get(col)
                                    .getName(),
                                    column.isNull(row) ? null
                                            : column.valueAsObject(row));
                        }
                        rows.add(values);
                    }
                }
                return rows;
            }
            finally
            {
                iterator.close();
            }
        }
        catch (RuntimeException | LinkageError e)
        {
            // A plugin's catalog that fails, or was built against another payloadbuilder: no metadata
            return List.of();
        }
    }

    private static List<ColumnMatch> distinctColumns(List<ColumnMatch> matches)
    {
        Set<String> seen = new LinkedHashSet<>();
        List<ColumnMatch> result = new ArrayList<>();
        for (ColumnMatch match : matches)
        {
            if (seen.add(match.displayName()
                    .toLowerCase(Locale.ROOT)))
            {
                result.add(match);
            }
        }
        return result;
    }

    private static List<CompletionItem> limitDistinct(List<CompletionItem> items, int maxItems)
    {
        Set<String> seen = new LinkedHashSet<>();
        List<CompletionItem> result = new ArrayList<>();
        for (CompletionItem item : items)
        {
            if (seen.add(item.label()
                    .toLowerCase(Locale.ROOT)))
            {
                result.add(item);
            }
            if (result.size() >= maxItems)
            {
                break;
            }
        }
        return result;
    }

    /** The table's columns from {@code sys#columns}, then those the provider looks up that {@code sys#columns} doesn't list. */
    private List<ColumnEntry> columnsForTable(Metadata metadata, String tableName)
    {
        List<ColumnEntry> listed = metadata.columns()
                .stream()
                .filter(column -> column.table()
                        .equalsIgnoreCase(tableName))
                .toList();
        if (tableColumns == null)
        {
            return listed;
        }
        // Only a listed table, by its listed name: a typo or an unknown alias never reaches the provider. The name as written first, since
        // a catalog may list names that differ only in case (MongoDB collections)
        TableEntry table = metadata.tables()
                .stream()
                .filter(t -> t.name()
                        .equals(tableName))
                .findFirst()
                .or(() -> metadata.tables()
                        .stream()
                        .filter(t -> t.name()
                                .equalsIgnoreCase(tableName))
                        .findFirst())
                .orElse(null);
        if (table == null)
        {
            return listed;
        }
        List<ColumnEntry> lookedUp = lookedUpColumns(metadata, table.name());
        if (lookedUp.isEmpty())
        {
            return listed;
        }
        Map<String, ColumnEntry> lookedUpByName = new LinkedHashMap<>();
        for (ColumnEntry column : lookedUp)
        {
            lookedUpByName.putIfAbsent(column.name()
                    .toLowerCase(Locale.ROOT), column);
        }
        List<ColumnEntry> result = new ArrayList<>();
        for (ColumnEntry column : listed)
        {
            // A listed column keeps its own type and detail; the lookup fills in what it lacks
            ColumnEntry found = lookedUpByName.remove(column.name()
                    .toLowerCase(Locale.ROOT));
            result.add(found == null ? column
                    : new ColumnEntry(column.table(), column.name(), column.type() != null ? column.type()
                            : found.type(),
                            column.detail() != null ? column.detail()
                                    : found.detail()));
        }
        result.addAll(lookedUpByName.values());
        return result;
    }

    /**
     * A table's looked-up columns, cached for {@link #CACHE_TTL_MS} from when the lookup finished. Concurrent requests for a table wait for one lookup rather than each starting their own.
     */
    private List<ColumnEntry> lookedUpColumns(Metadata metadata, String tableName)
    {
        MetadataKey m = metadata.key();
        // Not by catalog instance, unlike the metadata: a provider may create a new catalog per request, and this cache is already the provider's own
        TableColumnsKey key = new TableColumnsKey(m.alias(), m.catalogId(), m.properties(), tableName);
        long now = System.currentTimeMillis();
        CachedColumns created = new CachedColumns();
        CachedColumns entry = tableColumnsCache.compute(key, (_, existing) -> existing != null
                && !existing.expired(now) ? existing
                        : created);
        if (entry != created)
        {
            return entry.columns.join();
        }
        List<ColumnEntry> columns = List.of();
        try
        {
            List<TableColumn> found = tableColumns.columns(new TableColumnsRequest(m.alias(), m.catalogId(), m.properties(), m.catalog(), metadata.session(), metadata.executionContext(), tableName));
            columns = found == null ? List.of()
                    : found.stream()
                            .filter(column -> column != null
                                    && !isBlank(column.name()))
                            .map(column -> new ColumnEntry(tableName, column.name(), blankToNull(column.type()), blankToNull(column.detail())))
                            .toList();
        }
        catch (RuntimeException | LinkageError e)
        {
            // Cached as none until it expires, so a failing lookup isn't repeated on every keystroke
        }
        finally
        {
            // Always, so requests waiting for this lookup never hang
            created.complete(columns, System.currentTimeMillis());
        }
        // Drop what expired, as for the metadata
        long done = System.currentTimeMillis();
        tableColumnsCache.values()
                .removeIf(cached -> cached.expired(done));
        return columns;
    }

    private ColumnEntry findColumn(Metadata metadata, String tableName, String columnName)
    {
        return columnsForTable(metadata, tableName).stream()
                .filter(column -> column.name()
                        .equalsIgnoreCase(columnName))
                .findFirst()
                .orElse(null);
    }

    private static Map<String, String> tableAliasesForCatalog(CompletionRequest request, Metadata metadata)
    {
        return tableAliasesForCatalog(request.catalogAlias(), request.defaultCatalogAlias(), request.aliases(), metadata, request.text());
    }

    private static Map<String, String> tableAliasesForCatalog(String catalogAlias, String defaultCatalogAlias, Map<String, String> aliases, Metadata metadata, String text)
    {
        Map<String, String> tableToAlias = new LinkedHashMap<>();
        if (aliases == null)
        {
            return tableToAlias;
        }
        for (Map.Entry<String, String> entry : aliases.entrySet())
        {
            String tableName = resolveTableNameForCatalog(catalogAlias, defaultCatalogAlias, entry.getValue());
            if (tableName == null
                    || !hasTable(metadata, tableName))
            {
                continue;
            }
            if (entry.getKey()
                    .equalsIgnoreCase(catalogAlias)
                    && !hasExplicitCatalogAlias(text, catalogAlias))
            {
                tableToAlias.putIfAbsent(tableName, tableName);
                continue;
            }
            tableToAlias.putIfAbsent(tableName, PayloadbuilderCatalogSqlEditorServices.stripCatalogPrefix(entry.getKey()));
        }
        return tableToAlias;
    }

    private static Map<String, String> normalizedAliases(Map<String, String> aliases)
    {
        Map<String, String> normalized = normalizeAliases(aliases);
        return normalized == null ? Map.of()
                : normalized;
    }

    private static String columnDisplayName(Map.Entry<String, String> tableToAlias, ColumnEntry column)
    {
        String tableName = tableToAlias.getKey();
        String alias = tableToAlias.getValue();
        return alias.equalsIgnoreCase(tableName) ? column.name()
                : alias + "." + column.name();
    }

    private static boolean hasExplicitCatalogAlias(String text, String catalogAlias)
    {
        if (isBlank(catalogAlias)
                || isBlank(text))
        {
            return false;
        }
        String alias = Pattern.quote(catalogAlias);
        String separator = Pattern.quote(String.valueOf(PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR));
        return Pattern.compile("(?i)\\b" + alias + separator + "[A-Z0-9_.$\"]+\\s+(?:AS\\s+)?" + alias + "\\b")
                .matcher(text)
                .find();
    }

    private static String resolveTableNameCandidate(String catalogAlias, String defaultCatalogAlias, String rawName, Metadata metadata)
    {
        String tableName = resolveTableNameForCatalog(catalogAlias, defaultCatalogAlias, rawName);
        if (tableName != null)
        {
            return tableName;
        }
        if (!isBlank(rawName)
                && hasTable(metadata, rawName))
        {
            return rawName;
        }
        return null;
    }

    /** A qualifier or token as typed in the editor that names a listed table: as typed, or with its quoted parts unquoted ({@code "shop".orders}). */
    private static String tableNameInMetadata(Metadata metadata, String raw)
    {
        if (isBlank(raw))
        {
            return null;
        }
        if (hasTable(metadata, raw))
        {
            return raw;
        }
        String unquoted = unquoteIdentifierParts(raw);
        return hasTable(metadata, unquoted) ? unquoted
                : null;
    }

    /**
     * What a qualifier or token as typed in the editor refers to: the table of the alias it names (alias keys and targets come from the SQL parser, unquoted), else the name itself unquoted. Unquoting
     * only the typed text keeps a target such as {@code shop.my "x"} from being unquoted twice.
     */
    private static String aliasTargetOrName(Map<String, String> aliases, String raw)
    {
        String typed = Objects.toString(raw, "");
        String unquoted = unquoteIdentifierParts(typed);
        String target = aliases.get(typed.toLowerCase(Locale.ROOT));
        if (target == null)
        {
            target = aliases.get(unquoted.toLowerCase(Locale.ROOT));
        }
        return target != null ? target
                : unquoted;
    }

    /**
     * A table name as the catalog's system tables list it: quoted identifier parts unquoted, so {@code "db"."my ""x""".coll} is {@code db.my "x".coll}. Payloadbuilder text may quote any part
     * ({@code mongo#"qmongo_showcase".orders}); the system tables never do.
     */
    static String unquoteIdentifierParts(String value)
    {
        if (value == null
                || value.indexOf('"') < 0)
        {
            return value;
        }
        StringBuilder result = new StringBuilder(value.length());
        boolean quoted = false;
        for (int i = 0; i < value.length(); i++)
        {
            char c = value.charAt(i);
            if (c != '"')
            {
                result.append(c);
            }
            else if (quoted
                    && i + 1 < value.length()
                    && value.charAt(i + 1) == '"')
            {
                result.append('"');
                i++;
            }
            else
            {
                quoted = !quoted;
            }
        }
        return result.toString();
    }

    private static boolean hasTable(Metadata metadata, String tableName)
    {
        return metadata.tables()
                .stream()
                .anyMatch(table -> table.name()
                        .equalsIgnoreCase(tableName));
    }

    private static String resolveTableNameForCatalog(String catalogAlias, String defaultCatalogAlias, String rawName)
    {
        if (isBlank(rawName))
        {
            return null;
        }
        // Check . separator (e.g., "jdbc.schema.table" — only possible if SQL parser treated # as part of name)
        String dotPrefix = catalogAlias + ".";
        if (rawName.regionMatches(true, 0, dotPrefix, 0, dotPrefix.length()))
        {
            String tableName = rawName.substring(dotPrefix.length());
            return isBlank(tableName) ? null
                    : tableName;
        }
        String catalogPrefix = catalogAlias + PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR;
        if (rawName.regionMatches(true, 0, catalogPrefix, 0, catalogPrefix.length()))
        {
            String tableName = rawName.substring(catalogPrefix.length());
            return isBlank(tableName) ? null
                    : tableName;
        }
        // If this catalog is the default, accept the raw name as-is (aliases are already normalized)
        if (catalogAlias.equalsIgnoreCase(Objects.toString(defaultCatalogAlias, "")))
        {
            return rawName;
        }
        return null;
    }

    private static String completionDisplayName(CompletionRequest request, String name, Map<String, String> aliases)
    {
        String prefix = Objects.toString(request.prefix(), "");
        String catalogAlias = request.catalogAlias();
        boolean defaultAlias = catalogAlias.equalsIgnoreCase(Objects.toString(request.defaultCatalogAlias(), ""));
        boolean typedCatalogPrefix = hasTypedCatalogPrefix(request);
        String qualified = catalogAlias + PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR + name;
        String unqualified = name;

        if (prefix.contains("."))
        {
            // Prefix is already normalized (catalogAlias# stripped by handler)
            if (startsWithIgnoreCase(qualified, prefix))
            {
                return qualified;
            }
            // Check if prefix starts with an alias mapping to this table
            int dotIdx = prefix.lastIndexOf('.');
            if (dotIdx >= 0)
            {
                String aliasCandidate = prefix.substring(0, dotIdx);
                String mapped = aliases.get(aliasCandidate.toLowerCase(Locale.ROOT));
                String mappedTable = resolveTableNameForCatalog(request.catalogAlias(), request.defaultCatalogAlias(), mapped);
                if (mappedTable != null
                        && mappedTable.equalsIgnoreCase(name))
                {
                    return prefix;
                }
            }
            return null;
        }

        if ((defaultAlias
                || typedCatalogPrefix)
                && startsWithIgnoreCase(unqualified, prefix))
        {
            return unqualified;
        }
        if (startsWithIgnoreCase(catalogAlias, prefix))
        {
            return qualified;
        }
        return null;
    }

    private static boolean hasTypedCatalogPrefix(CompletionRequest request)
    {
        if (request == null
                || isBlank(request.text())
                || request.line() <= 0
                || request.replaceStartColumn() <= 1)
        {
            return false;
        }
        String[] lines = request.text()
                .split("\\R", -1);
        if (request.line() > lines.length)
        {
            return false;
        }
        String currentLine = lines[request.line() - 1];
        int tokenStartIndex = Math.max(0, Math.min(currentLine.length(), request.replaceStartColumn() - 1));
        int separatorIndex = tokenStartIndex - 1;
        if (separatorIndex < 0
                || currentLine.charAt(separatorIndex) != PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR)
        {
            return false;
        }
        int aliasStart = separatorIndex;
        while (aliasStart > 0)
        {
            char c = currentLine.charAt(aliasStart - 1);
            if (Character.isLetterOrDigit(c)
                    || c == '_')
            {
                aliasStart--;
                continue;
            }
            break;
        }
        return aliasStart < separatorIndex
                && currentLine.substring(aliasStart, separatorIndex)
                        .equalsIgnoreCase(request.catalogAlias());
    }

    private static String tableDisplayName(HoverRequest request, String name)
    {
        return tableDisplayName(request.catalogAlias(), request.defaultCatalogAlias(), name);
    }

    private static String tableDisplayName(SymbolRequest request, String name)
    {
        return tableDisplayName(request.catalogAlias(), request.defaultCatalogAlias(), name);
    }

    private static String tableDisplayName(String catalogAlias, String defaultCatalogAlias, String name)
    {
        return catalogAlias.equalsIgnoreCase(Objects.toString(defaultCatalogAlias, "")) ? name
                : catalogAlias + PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR + name;
    }

    private static String functionDisplayName(HoverRequest request, String name)
    {
        return request.catalogAlias()
                .equalsIgnoreCase(Objects.toString(request.defaultCatalogAlias(), "")) ? name
                        : request.catalogAlias() + PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR + name;
    }

    private static String functionDisplayName(SymbolRequest request, String name)
    {
        return request.catalogAlias()
                .equalsIgnoreCase(Objects.toString(request.defaultCatalogAlias(), "")) ? name
                        : request.catalogAlias() + PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR + name;
    }

    private String tableMarkdown(HoverRequest request, Metadata metadata, TableEntry table)
    {
        String displayName = tableDisplayName(request, table.name());
        StringBuilder md = new StringBuilder();
        md.append("**Payloadbuilder Table: ")
                .append(displayName)
                .append("**\n\n");
        List<ColumnEntry> columns = columnsForTable(metadata, table.name());
        if (!columns.isEmpty())
        {
            md.append("| Column | Type |\n");
            md.append("|---|---|\n");
            for (ColumnEntry column : columns)
            {
                md.append("| ")
                        .append(tableCell(column.name()))
                        .append(" | ")
                        .append(tableCell(Objects.toString(column.type(), "")))
                        .append(" |\n");
            }
        }
        return md.toString();
    }

    /** Text as one markdown table cell: a looked-up name or type such as {@code string | null} may hold a pipe. */
    private static String tableCell(String value)
    {
        return oneLine(value).replace("|", "\\|");
    }

    private static String oneLine(String value)
    {
        return value.replaceAll("\\R", " ");
    }

    private static String columnMarkdown(HoverRequest request, ColumnMatch column)
    {
        StringBuilder md = new StringBuilder();
        md.append("**Payloadbuilder Column: ")
                .append(column.displayName())
                .append("**\n\n");
        if (!isBlank(column.column()
                .type()))
        {
            md.append("- Type: `")
                    .append(column.column()
                            .type())
                    .append("`\n");
        }
        if (!isBlank(column.column()
                .detail()))
        {
            md.append("- ")
                    .append(oneLine(column.column()
                            .detail()))
                    .append("\n");
        }
        md.append("- Catalog: `")
                .append(request.catalogAlias())
                .append("`\n");
        md.append("- Table: `")
                .append(column.tableName())
                .append("`\n");
        return md.toString();
    }

    private static String functionMarkdown(HoverRequest request, FunctionEntry function)
    {
        StringBuilder md = new StringBuilder();
        md.append("**Payloadbuilder Function: ")
                .append(functionDisplayName(request, function.name()))
                .append("**\n\n");
        md.append("- Type: `")
                .append(function.type())
                .append("`\n");
        if (!isBlank(function.description()))
        {
            md.append("\n")
                    .append(function.description())
                    .append("\n");
        }
        return md.toString();
    }

    private static String source(CompletionRequest request)
    {
        return "payloadbuilder." + request.catalogId();
    }

    private static boolean startsWithIgnoreCase(String value, String prefix)
    {
        return value.regionMatches(true, 0, prefix, 0, prefix.length());
    }

    private static String quoteInvalidIdentifierParts(String value)
    {
        int catalogSeparator = value.indexOf(PayloadbuilderCatalogSqlEditorServices.CATALOG_PREFIX_SEPARATOR);
        String prefix = catalogSeparator < 0 ? ""
                : value.substring(0, catalogSeparator + 1);
        String qualifiedName = catalogSeparator < 0 ? value
                : value.substring(catalogSeparator + 1);
        String[] parts = qualifiedName.split("\\.", -1);
        for (int i = 0; i < parts.length; i++)
        {
            if (!SIMPLE_IDENTIFIER.matcher(parts[i])
                    .matches()
                    && !QUOTED_IDENTIFIER.matcher(parts[i])
                            .matches())
            {
                parts[i] = "\"" + parts[i].replace("\"", "\"\"") + "\"";
            }
        }
        return prefix + String.join(".", parts);
    }

    private static String stringValue(Object value)
    {
        return value == null ? null
                : value.toString();
    }

    private static String blankToNull(String value)
    {
        return isBlank(value) ? null
                : value;
    }

    /** What the system tables and functions list for a catalog instance; cached. */
    private record CatalogMetadata(List<TableEntry> tables, List<ColumnEntry> columns, List<FunctionEntry> functions)
    {
        private static final CatalogMetadata EMPTY = new CatalogMetadata(List.of(), List.of(), List.of());
    }

    /** The cached metadata with the request it serves, whose session a column lookup runs in. */
    private record Metadata(CatalogMetadata data, MetadataKey key, se.kuseman.payloadbuilder.api.execution.IQuerySession session,
            se.kuseman.payloadbuilder.api.execution.IExecutionContext executionContext)
    {
        List<TableEntry> tables()
        {
            return data.tables();
        }

        List<ColumnEntry> columns()
        {
            return data.columns();
        }

        List<FunctionEntry> functions()
        {
            return data.functions();
        }
    }

    private record TableEntry(String name)
    {
    }

    private record ColumnEntry(String table, String name, String type, String detail)
    {
    }

    private record FunctionEntry(String name, String type, String description)
    {
    }

    private record ColumnMatch(String tableName, ColumnEntry column, String displayName)
    {
    }

    /** By catalog instance too: a plugin that takes over a catalog id never gets the replaced catalog's metadata. */
    private record MetadataKey(String alias, String catalogId, se.kuseman.payloadbuilder.api.catalog.Catalog catalog, Map<String, Object> properties)
    {
    }

    private record CachedMetadata(CatalogMetadata metadata, long createdAtMs)
    {
    }

    /** A table by its listed name, exactly as listed, of a catalog alias and its properties. */
    private record TableColumnsKey(String alias, String catalogId, Map<String, Object> properties, String table)
    {
    }

    /** A lookup that is running or done; it expires {@link #CACHE_TTL_MS} after it finished. */
    private static final class CachedColumns
    {
        private final CompletableFuture<List<ColumnEntry>> columns = new CompletableFuture<>();
        private volatile long completedAtMs;

        void complete(List<ColumnEntry> value, long nowMs)
        {
            completedAtMs = nowMs;
            columns.complete(value);
        }

        boolean expired(long nowMs)
        {
            return columns.isDone()
                    && nowMs - completedAtMs > CACHE_TTL_MS;
        }
    }
}
