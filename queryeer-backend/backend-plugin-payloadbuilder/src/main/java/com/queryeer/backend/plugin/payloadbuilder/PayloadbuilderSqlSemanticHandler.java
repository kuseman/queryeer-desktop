package com.queryeer.backend.plugin.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;
import com.queryeer.backend.queryengine.sql.parser.SqlCompletionSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlContextDetector;
import com.queryeer.backend.queryengine.sql.parser.SqlHoverSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlParseContext;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.cache.InMemoryGenericCache;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.ExecutionContext;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

/** Handles Payloadbuilder SQL semantic operations against opted-in catalog editor services. */
final class PayloadbuilderSqlSemanticHandler
{
    private static final String CATALOG_PREFIX_SEPARATOR = "#";
    private static final InMemoryGenericCache GENERIC_CACHE = new InMemoryGenericCache("PayloadbuilderSqlEditorServices", true);

    private final PayloadMapper payloadMapper;
    private final IncrementalParseSessionService parseSessions;
    private final String engineId;
    private final PayloadbuilderCatalogProviderRegistry catalogProviders;

    PayloadbuilderSqlSemanticHandler(PayloadMapper payloadMapper, IncrementalParseSessionService parseSessions, String engineId, PayloadbuilderCatalogProviderRegistry catalogProviders)
    {
        this.payloadMapper = payloadMapper;
        this.parseSessions = parseSessions;
        this.engineId = engineId;
        this.catalogProviders = catalogProviders;
    }

    Object complete(String fileId, Object payload)
    {
        return SqlCompletionSupport.complete(payloadMapper, parseSessions, engineId, fileId, payload, this::semanticCompletions);
    }

    Object hover(String fileId, Object payload)
    {
        return SqlHoverSupport.hover(payloadMapper, parseSessions, engineId, fileId, payload, this::semanticHover);
    }

    Object symbolAtPosition(String fileId, Object payload)
    {
        SqlSymbolAtPositionPayload params = payloadMapper.convert(payload, SqlSymbolAtPositionPayload.class);
        if (params == null
                || params.cursor() == null)
        {
            return null;
        }
        String effectiveFileId = isBlank(fileId) ? params.fileId()
                : fileId;
        String token = SqlCompletionSupport.identifierAtPosition(parseSessions, engineId, effectiveFileId, params.text(), params.cursor()
                .line(),
                params.cursor()
                        .column());
        if (token == null)
        {
            return null;
        }

        TSTree tree = resolveTree(params.text());
        SqlParseContext context = SqlParseContext.OTHER;
        if (tree != null)
        {
            context = SqlContextDetector.detectContext(tree, params.text(), params.cursor()
                    .line(),
                    params.cursor()
                            .column());
        }
        Map<String, String> aliases = tree != null
                && context != SqlParseContext.OTHER
                        ? SqlCompletionSupport.extractAliases(tree, params.text(), params.cursor()
                                .line(),
                                params.cursor()
                                        .column())
                        : Map.of();

        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = parseEngineState(params.engineState());
        CatalogRuntime resolved = resolveCatalogAndRuntime(token, aliases, state);
        if (resolved != null)
        {
            String normalizedToken = normalizeToken(token, resolved.catalogAlias);
            PayloadbuilderCatalogSqlEditorServices.Symbol symbol = resolved.runtime.tools()
                    .symbolAtPosition(new PayloadbuilderCatalogSqlEditorServices.SymbolRequest(resolved.catalogAlias, resolved.runtime.instance()
                            .catalogId(), state.defaultCatalogAlias(),
                            resolved.runtime.instance()
                                    .properties(),
                            resolved.runtime.catalog(), resolved.runtime.session(), resolved.runtime.executionContext(), params.text(), context.name(), normalizedToken, params.cursor()
                                    .line(),
                            params.cursor()
                                    .column(),
                            aliases));
            if (symbol != null)
            {
                return toSymbolMap(symbol);
            }
        }
        return null;
    }

    private List<Map<String, Object>> semanticCompletions(SqlCompletionSupport.SqlCompletePayload payload, String fileId, SqlCompletionSupport.SqlCompleteCursor cursor, String prefix,
            int replaceStartColumn, int maxItems, SqlParseContext context, Map<String, String> aliases)
    {
        if (context == SqlParseContext.OTHER)
        {
            return List.of();
        }
        String catalogAlias = extractCatalogAlias(prefix);
        boolean typedCatalogPrefix = catalogAlias != null;
        String normalizedPrefix = prefix;
        int normalizedReplaceStartColumn = replaceStartColumn;
        if (catalogAlias == null)
        {
            catalogAlias = findCatalogAliasByAliasReference(prefix, aliases);
        }
        if (typedCatalogPrefix)
        {
            int sep = prefix.indexOf(CATALOG_PREFIX_SEPARATOR);
            normalizedPrefix = prefix.substring(sep + 1);
            normalizedReplaceStartColumn = replaceStartColumn + sep + 1;
        }
        if (catalogAlias == null)
        {
            catalogAlias = findCatalogAliasByCurrentRelations(aliases);
        }
        if (catalogAlias == null)
        {
            catalogAlias = findCatalogAliasBeforeCurrentToken(payload == null ? null
                    : payload.text(), cursor.line(), replaceStartColumn);
        }
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = parseEngineState(payload == null ? null
                : payload.engineState());
        if (catalogAlias == null)
        {
            catalogAlias = state.defaultCatalogAlias();
        }
        List<Map<String, Object>> result = new ArrayList<>();
        if (catalogAlias != null)
        {
            ToolRuntime runtime = findRuntimeByAlias(toolRuntimes(state), catalogAlias);
            if (runtime != null)
            {
                List<PayloadbuilderCatalogSqlEditorServices.CompletionItem> items = runtime.tools()
                        .complete(new PayloadbuilderCatalogSqlEditorServices.CompletionRequest(catalogAlias, runtime.instance()
                                .catalogId(), state.defaultCatalogAlias(),
                                runtime.instance()
                                        .properties(),
                                runtime.catalog(), runtime.session(), runtime.executionContext(), payload == null ? null
                                        : payload.text(),
                                context.name(), normalizedPrefix, normalizedReplaceStartColumn, cursor.line(), cursor.column(), maxItems, aliases));
                for (PayloadbuilderCatalogSqlEditorServices.CompletionItem item : items)
                {
                    Map<String, Object> mapped = toCompletionMap(item, cursor, normalizedReplaceStartColumn);
                    if (!mapped.isEmpty())
                    {
                        result.add(mapped);
                    }
                }
                return result.stream()
                        .limit(maxItems)
                        .toList();
            }
        }
        return result;
    }

    private static String findCatalogAliasBeforeCurrentToken(String text, int line, int replaceStartColumn)
    {
        if (isBlank(text)
                || line <= 0
                || replaceStartColumn <= 1)
        {
            return null;
        }
        String[] lines = text.split("\\R", -1);
        if (line > lines.length)
        {
            return null;
        }
        String currentLine = lines[line - 1];
        int tokenStartIndex = Math.max(0, Math.min(currentLine.length(), replaceStartColumn - 1));
        int separatorIndex = tokenStartIndex - 1;
        if (separatorIndex < 0
                || currentLine.charAt(separatorIndex) != CATALOG_PREFIX_SEPARATOR.charAt(0))
        {
            return null;
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
        if (aliasStart == separatorIndex)
        {
            return null;
        }
        return currentLine.substring(aliasStart, separatorIndex);
    }

    private Map<String, Object> semanticHover(SqlHoverSupport.SqlHoverPayload payload, String fileId, SqlHoverSupport.SqlHoverCursor cursor, String token, SqlParseContext context,
            Map<String, String> aliases)
    {
        String catalogAlias = extractCatalogAlias(token);
        if (context == SqlParseContext.OTHER
                && catalogAlias == null)
        {
            return null;
        }
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = parseEngineState(payload == null ? null
                : payload.engineState());
        CatalogRuntime resolved = resolveCatalogAndRuntime(token, aliases, state);
        if (resolved != null)
        {
            String normalizedToken = normalizeToken(token, resolved.catalogAlias);
            PayloadbuilderCatalogSqlEditorServices.Hover hover = resolved.runtime.tools()
                    .hover(new PayloadbuilderCatalogSqlEditorServices.HoverRequest(resolved.catalogAlias, resolved.runtime.instance()
                            .catalogId(), state.defaultCatalogAlias(),
                            resolved.runtime.instance()
                                    .properties(),
                            resolved.runtime.catalog(), resolved.runtime.session(), resolved.runtime.executionContext(), payload == null ? null
                                    : payload.text(),
                            context.name(), normalizedToken, cursor.line(), cursor.column(), aliases));
            if (hover != null
                    && !isBlank(hover.markdown()))
            {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("contents", List.of(Map.of("value", hover.markdown(), "isTrusted", false)));
                return result;
            }
        }
        if (isEngineStateEmpty(state))
        {
            return noConnectionHover();
        }
        return null;
    }

    private CatalogRuntime resolveCatalogAndRuntime(String name, Map<String, String> aliases, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        String catalogAlias = extractCatalogAlias(name);
        if (catalogAlias == null)
        {
            catalogAlias = findCatalogAliasByAliasReference(name, aliases);
        }
        if (catalogAlias == null)
        {
            catalogAlias = findCatalogAliasByCurrentRelations(aliases);
        }
        if (catalogAlias == null)
        {
            catalogAlias = state.defaultCatalogAlias();
        }
        if (catalogAlias == null)
        {
            return null;
        }
        ToolRuntime runtime = findRuntimeByAlias(toolRuntimes(state), catalogAlias);
        return runtime == null ? null
                : new CatalogRuntime(catalogAlias, runtime);
    }

    private static String normalizeToken(String token, String catalogAlias)
    {
        return token.startsWith(catalogAlias + CATALOG_PREFIX_SEPARATOR) ? token.substring(catalogAlias.length() + 1)
                : token;
    }

    /**
     * Extracts the catalog alias from a fully qualified name (e.g., "jdbc#sys.tables" → "jdbc"). Returns {@code null} if the name is not qualified with a catalog prefix.
     */
    private static String extractCatalogAlias(String qualifiedName)
    {
        if (isBlank(qualifiedName))
        {
            return null;
        }
        int separatorIndex = qualifiedName.indexOf(CATALOG_PREFIX_SEPARATOR);
        if (separatorIndex <= 0)
        {
            return null;
        }
        return qualifiedName.substring(0, separatorIndex);
    }

    /**
     * Finds the catalog alias by looking up a table alias in the aliases map. For example, if the user types "lp." (where lp is an alias for "jdbc#dbo.Article_ListPage"), this method looks up "lp" in
     * the aliases map, finds "jdbc#dbo.Article_ListPage", extracts "jdbc" as the catalog alias.
     */
    private static String findCatalogAliasByAliasReference(String prefix, Map<String, String> aliases)
    {
        if (isBlank(prefix)
                || aliases == null
                || aliases.isEmpty())
        {
            return null;
        }
        int dotIndex = prefix.indexOf('.');
        String aliasName = dotIndex > 0 ? prefix.substring(0, dotIndex)
                : prefix;
        String tableReference = aliases.get(aliasName);
        if (tableReference != null)
        {
            return extractCatalogAlias(tableReference);
        }
        return null;
    }

    private static String findCatalogAliasByCurrentRelations(Map<String, String> aliases)
    {
        if (aliases == null
                || aliases.isEmpty())
        {
            return null;
        }
        String catalogAlias = null;
        for (Map.Entry<String, String> entry : aliases.entrySet())
        {
            String candidate = extractCatalogAlias(entry.getValue());
            if (candidate == null)
            {
                candidate = extractCatalogAlias(entry.getKey());
            }
            if (candidate == null)
            {
                continue;
            }
            if (catalogAlias == null)
            {
                catalogAlias = candidate;
                continue;
            }
            if (!catalogAlias.equalsIgnoreCase(candidate))
            {
                return null;
            }
        }
        return catalogAlias;
    }

    private static boolean isEngineStateEmpty(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        return state.defaultCatalogAlias() == null
                && state.instancesByAlias()
                        .isEmpty();
    }

    private static Map<String, Object> noConnectionHover()
    {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("contents", List.of(Map.of("value", "**No active connection**  \nOpen a security session to enable hover information.", "isTrusted", false)));
        return result;
    }

    private static ToolRuntime findRuntimeByAlias(List<ToolRuntime> runtimes, String alias)
    {
        for (ToolRuntime runtime : runtimes)
        {
            if (alias.equals(runtime.instance()
                    .alias()))
            {
                return runtime;
            }
        }
        return null;
    }

    private PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState parseEngineState(Object engineState)
    {
        try
        {
            return PayloadbuilderEngineStateSupport.parse(payloadMapper.convert(engineState, PayloadbuilderEngineState.class));
        }
        catch (RuntimeException e)
        {
            return new PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState(null, null, Map.of());
        }
    }

    private List<ToolRuntime> toolRuntimes(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        if (state.instancesByAlias()
                .isEmpty())
        {
            return List.of();
        }

        List<ToolRuntime> result = new ArrayList<>();
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            ToolRuntime runtime = createRuntime(instance, state);
            if (runtime != null)
            {
                result.add(runtime);
            }
        }
        return result;
    }

    private ToolRuntime createRuntime(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        PayloadbuilderCatalogProviderContributor provider = catalogProviders.getCatalogProvider(instance.catalogId());
        if (provider == null)
        {
            return null;
        }
        PayloadbuilderCatalogSqlEditorServices tools = provider.editorServices();
        if (tools == null
                || tools == PayloadbuilderCatalogSqlEditorServices.NONE)
        {
            return null;
        }
        try
        {
            Catalog catalog = provider.createCatalog();
            if (catalog == null)
            {
                return null;
            }
            CatalogRegistry registry = new CatalogRegistry();
            registry.registerCatalog(instance.alias(), catalog);
            QuerySession session = new QuerySession(registry, Map.of());
            session.setGenericCache(GENERIC_CACHE);
            provider.injectProperties(session, instance.alias(), instance.properties());
            applyInputProperties(session, state);
            ExecutionContext executionContext = new ExecutionContext(session);
            return new ToolRuntime(instance, tools, catalog, session, executionContext);
        }
        catch (RuntimeException e)
        {
            return null;
        }
    }

    private static void applyInputProperties(QuerySession session, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        if (state.defaultCatalogAlias() != null)
        {
            session.setDefaultCatalogAlias(state.defaultCatalogAlias());
        }
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            for (Map.Entry<String, Object> property : instance.properties()
                    .entrySet())
            {
                ValueVector vector = property.getValue() == null ? ValueVector.literalNull(ResolvedType.ANY, 1)
                        : ValueVector.literalAny(1, property.getValue());
                session.setCatalogProperty(instance.alias(), property.getKey(), vector);
            }
        }
    }

    private static Map<String, Object> toCompletionMap(PayloadbuilderCatalogSqlEditorServices.CompletionItem item, SqlCompletionSupport.SqlCompleteCursor cursor, int replaceStartColumn)
    {
        if (item == null
                || isBlank(item.label()))
        {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("label", item.label());
        result.put("kind", isBlank(item.kind()) ? "text"
                : item.kind());
        putIfNotBlank(result, "detail", item.detail());
        putIfNotBlank(result, "documentation", item.documentation());
        result.put("insertText", isBlank(item.insertText()) ? item.label()
                : item.insertText());
        result.put("insertTextFormat", isBlank(item.insertTextFormat()) ? "plain"
                : item.insertTextFormat());
        putIfNotBlank(result, "source", item.source());
        result.put("replaceRange", Map.of("startLine", cursor.line(), "startColumn", replaceStartColumn, "endLine", cursor.line(), "endColumn", cursor.column()));
        return result;
    }

    private static Map<String, Object> toSymbolMap(PayloadbuilderCatalogSqlEditorServices.Symbol symbol)
    {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("kind", symbol.kind());
        result.put("name", symbol.name());
        result.put("fullName", symbol.fullName() == null ? symbol.name()
                : symbol.fullName());
        putIfNotBlank(result, "detail", symbol.detail());
        if (symbol.attributes() != null
                && !symbol.attributes()
                        .isEmpty())
        {
            result.put("attributes", symbol.attributes());
        }
        return result;
    }

    private static TSTree resolveTree(String text)
    {
        if (isBlank(text))
        {
            return null;
        }
        try (TSParser parser = new TSParser())
        {
            parser.setLanguage(new TreeSitterSql());
            return parser.parseString(null, text);
        }
    }

    private static void putIfNotBlank(Map<String, Object> target, String key, String value)
    {
        if (!isBlank(value))
        {
            target.put(key, value);
        }
    }

    private record ToolRuntime(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance, PayloadbuilderCatalogSqlEditorServices tools, Catalog catalog, QuerySession session,
            ExecutionContext executionContext)
    {
    }

    private record CatalogRuntime(String catalogAlias, ToolRuntime runtime)
    {
    }

    private record SqlSymbolAtPositionPayload(String fileId, String text, SymbolCursor cursor, Object engineState)
    {
    }

    private record SymbolCursor(int line, int column)
    {
    }
}
