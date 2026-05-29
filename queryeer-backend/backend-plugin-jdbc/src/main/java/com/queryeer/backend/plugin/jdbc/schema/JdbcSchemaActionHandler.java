package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcTreeBranch;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaActionHandler
{
    private static final String ERROR_CONNECTION_ID_REQUIRED = "connectionId is required";
    private static final String ERROR_TARGET_SCHEMA_REQUIRED = "target.schema is required for scope=deep";

    private final PayloadMapper payloadMapper;
    private final DefaultJdbcConnections connections;
    private final JdbcSchemaRouter router;
    private final JdbcSchemaStore schemaStore;
    private final JdbcSchemaCrawlCoordinator crawlCoordinator;
    private final JdbcConnectionHealth connectionHealth;

    public JdbcSchemaActionHandler(PayloadMapper payloadMapper, DefaultJdbcConnections connections, JdbcSchemaRouter router, JdbcSchemaStore schemaStore, JdbcSchemaCrawlCoordinator crawlCoordinator,
            JdbcConnectionHealth connectionHealth)
    {
        this.payloadMapper = payloadMapper;
        this.connections = connections;
        this.router = router;
        this.schemaStore = schemaStore;
        this.crawlCoordinator = crawlCoordinator;
        this.connectionHealth = connectionHealth;
    }

    public Object fetch(Object payload)
    {
        JdbcSchemaFetchPayload params = payloadMapper.convert(payload, JdbcSchemaFetchPayload.class);
        String connectionId = params.connectionId();
        JdbcConnection resolved = connections.resolve(connectionId);

        String parentKind = params.parentKind() != null ? params.parentKind()
                : params.scope();
        if (parentKind == null)
        {
            parentKind = "connection";
        }

        JdbcSchemaTarget target = params.target();
        // "connection" and "databases_container" are semantically equivalent for routing
        String resolveKind = "connection".equals(parentKind) ? "databases_container"
                : parentKind;
        List<JdbcSchemaObject> result;
        try
        {
            result = new ArrayList<>(router.resolve(resolved, resolveKind, target));
            connectionHealth.onSuccess(connectionId);
        }
        catch (RuntimeException e)
        {
            connectionHealth.onFailure(connectionId);
            throw e;
        }

        // Merge dialect tree branches at connection level
        if ("connection".equals(parentKind))
        {
            for (JdbcTreeBranch branch : resolved.dialect()
                    .treeBranches())
            {
                if ("connection".equals(branch.parentKind()))
                {
                    result.add(new JdbcSchemaObject(branch.kind() + ":" + resolved.connectionId(), branch.displayName(), branch.kind(), branch.nodeType(), null, null, Map.of()));
                }
            }
        }
        // Merge dialect tree branches at schema level (additional folders)
        else if ("schema".equals(parentKind))
        {
            for (JdbcTreeBranch branch : resolved.dialect()
                    .treeBranches())
            {
                if ("schema".equals(branch.parentKind()))
                {
                    Map<String, Object> attrs = new LinkedHashMap<>();
                    if (target != null)
                    {
                        if (target.database() != null)
                        {
                            attrs.put("catalog", target.database());
                        }
                        if (target.schema() != null)
                        {
                            attrs.put("schema", target.schema());
                        }
                    }
                    // Include schema context in identifier so folders under different schemas don't collide
                    String schemaSuffix = (target != null
                            && target.schema() != null ? "." + target.schema()
                                    : "");
                    result.add(
                            new JdbcSchemaObject(branch.kind() + ":" + resolved.connectionId() + schemaSuffix, branch.displayName(), branch.kind(), branch.nodeType(), null, null, Map.copyOf(attrs)));
                }
            }
        }

        return result;
    }

    public Object snapshot(Object payload)
    {
        JdbcSchemaSnapshotPayload params = payloadMapper.convert(payload, JdbcSchemaSnapshotPayload.class);
        String connectionId = trimToNull(params.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }

        String scope = trimToNull(params.scope());
        JdbcSchemaCrawlScope crawlScope = "deep".equalsIgnoreCase(scope) ? JdbcSchemaCrawlScope.DEEP
                : JdbcSchemaCrawlScope.TOP;
        return schemaStore.latestSnapshot(connectionId, crawlScope);
    }

    public Object status(Object payload)
    {
        JdbcSchemaStatusPayload params = payload != null ? payloadMapper.convert(payload, JdbcSchemaStatusPayload.class)
                : new JdbcSchemaStatusPayload(null);
        String requestedConnectionId = trimToNull(params.connectionId());

        List<String> connectionIds = requestedConnectionId != null ? List.of(requestedConnectionId)
                : connections.allConfiguredConnectionIds();

        List<JdbcSchemaCrawlStatus> result = new ArrayList<>();
        for (String connectionId : connectionIds)
        {
            String connectionTitle = resolveConnectionTitle(connectionId);
            result.addAll(buildStatusForConnection(connectionId, connectionTitle));
        }
        return result;
    }

    private List<JdbcSchemaCrawlStatus> buildStatusForConnection(String connectionId, String connectionTitle)
    {
        List<JdbcSchemaCrawlStatus> result = new ArrayList<>();

        // TOP scope status (single H2 open)
        List<JdbcSchemaStore.CrawlStatusEntry> topEntries = schemaStore.crawlStatusForConnection(connectionId, JdbcSchemaCrawlScope.TOP);
        for (JdbcSchemaStore.CrawlStatusEntry entry : topEntries)
        {
            result.add(new JdbcSchemaCrawlStatus(connectionId, connectionTitle, "top", entry.databaseKey(), entry.lastSuccessAt(), entry.lastAttemptAt(), entry.lastFailureAt(), entry.nextDueAt(),
                    entry.consecutiveFailures(), entry.usageScore(), entry.enabled(), entry.objectCount(), entry.lastError()));
        }

        // DEEP scope status for each database (single H2 open)
        List<JdbcSchemaStore.CrawlStatusEntry> deepEntries = schemaStore.crawlStatusForConnection(connectionId, JdbcSchemaCrawlScope.DEEP);
        for (JdbcSchemaStore.CrawlStatusEntry entry : deepEntries)
        {
            result.add(new JdbcSchemaCrawlStatus(connectionId, connectionTitle, "deep", entry.databaseKey(), entry.lastSuccessAt(), entry.lastAttemptAt(), entry.lastFailureAt(), entry.nextDueAt(),
                    entry.consecutiveFailures(), entry.usageScore(), entry.enabled(), entry.objectCount(), entry.lastError()));
        }

        return result;
    }

    private String resolveConnectionTitle(String connectionId)
    {
        try
        {
            JdbcConnection resolved = connections.resolve(connectionId);
            return resolved.title() != null ? resolved.title()
                    : connectionId;
        }
        catch (RuntimeException e)
        {
            return connectionId;
        }
    }

    public Object refresh(Object payload)
    {
        JdbcSchemaRefreshPayload params = payloadMapper.convert(payload, JdbcSchemaRefreshPayload.class);
        String connectionId = trimToNull(params.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }

        String scope = trimToNull(params.scope());
        JdbcSchemaCrawlScope crawlScope;
        if (scope == null
                || "top".equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.TOP;
        }
        else if ("deep".equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.DEEP;
        }
        else
        {
            throw new IllegalArgumentException("scope must be one of: top, deep");
        }

        JdbcSchemaTarget target = null;
        JdbcSchemaTarget incomingTarget = params.target();
        String mode = trimToNull(params.mode());
        boolean dueMode = "due".equalsIgnoreCase(mode);
        boolean forceMode = "force".equalsIgnoreCase(mode);
        boolean waitForCompletion = params.waitForCompletion() == null
                || params.waitForCompletion();
        if (crawlScope == JdbcSchemaCrawlScope.DEEP)
        {
            String schema = incomingTarget != null ? trimToNull(incomingTarget.schema())
                    : null;
            String database = incomingTarget != null ? trimToNull(incomingTarget.database())
                    : null;

            // Force mode without schema: trigger a full crawl for the database
            if (forceMode
                    && schema == null)
            {
                target = new JdbcSchemaTarget(database, null);
                return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
            }

            if (schema == null
                    && !dueMode)
            {
                throw new IllegalArgumentException(ERROR_TARGET_SCHEMA_REQUIRED);
            }

            target = new JdbcSchemaTarget(database, schema);

            if (dueMode)
            {
                return crawlCoordinator.refreshDue(connectionId, crawlScope, target, waitForCompletion);
            }

            JdbcConnection resolved = connections.resolve(connectionId);
            List<JdbcSchemaObject> fetchedTables = router.resolve(resolved, "tables_folder", target);
            List<JdbcSchemaObject> fetchedViews = router.resolve(resolved, "views_folder", target);
            List<JdbcSchemaObject> fetchedProcedures = router.resolve(resolved, "procedures_folder", target);
            // Expand each table to include column children in the snapshot
            List<JdbcSchemaObject> expandedTables = expandTableColumns(resolved, fetchedTables);
            List<JdbcSchemaObject> expandedViews = expandTableColumns(resolved, fetchedViews);
            List<JdbcSchemaObject> expanded = new ArrayList<>(expandedTables.size() + expandedViews.size() + fetchedProcedures.size());
            expanded.addAll(expandedTables);
            expanded.addAll(expandedViews);
            expanded.addAll(fetchedProcedures);
            schemaStore.persistDeepSnapshotTarget(connectionId, target.database(), target.schema(), expanded);
            return schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP);
        }

        if (dueMode)
        {
            return crawlCoordinator.refreshDue(connectionId, crawlScope, target, waitForCompletion);
        }

        return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
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
            String catalog = stringValue(table.attributes(), "catalog");
            String schema = stringValue(table.attributes(), "schema");
            String tableName = table.name();
            if (isBlank(tableName))
            {
                continue;
            }
            JdbcSchemaTarget tableTarget = new JdbcSchemaTarget(!isBlank(catalog) ? catalog
                    : null,
                    !isBlank(schema) ? schema
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
