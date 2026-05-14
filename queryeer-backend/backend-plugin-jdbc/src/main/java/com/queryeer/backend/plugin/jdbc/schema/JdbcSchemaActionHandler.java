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
        boolean waitForCompletion = params.waitForCompletion() == null
                || params.waitForCompletion();
        if (crawlScope == JdbcSchemaCrawlScope.DEEP)
        {
            String schema = incomingTarget != null ? trimToNull(incomingTarget.schema())
                    : null;
            String database = incomingTarget != null ? trimToNull(incomingTarget.database())
                    : null;
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
            List<JdbcSchemaObject> fetched = router.resolve(resolved, "tables_folder", target);
            // Expand each table to include column children in the snapshot
            List<JdbcSchemaObject> expanded = expandTableColumns(resolved, fetched);
            List<JdbcSchemaObject> current = new ArrayList<>(schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP));
            mergeTablesScope(current, target.database(), target.schema(), expanded);
            schemaStore.persistSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP, current);
            return current;
        }

        if (dueMode)
        {
            return crawlCoordinator.refreshDue(connectionId, crawlScope, target, waitForCompletion);
        }

        return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
    }

    private static void mergeTablesScope(List<JdbcSchemaObject> roots, String database, String schema, List<JdbcSchemaObject> fetched)
    {
        String db = database != null ? database
                : inferDatabase(fetched);
        if (db == null)
        {
            db = "default";
        }

        JdbcSchemaObject dbNode = upsertChild(roots, new JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<JdbcSchemaObject> dbChildren = mutableChildren(dbNode);

        if (schema == null)
        {
            mergeInto(dbChildren, fetched);
            replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
            return;
        }

        JdbcSchemaObject schemaNode = upsertChild(dbChildren, new JdbcSchemaObject(db + "." + schema, schema, "schema", List.of(), Map.of("catalog", db)));
        List<JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
        mergeInto(schemaChildren, fetched);
        replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
        replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
    }

    private static String inferDatabase(List<JdbcSchemaObject> objects)
    {
        for (JdbcSchemaObject object : objects)
        {
            Object catalog = object.attributes()
                    .get("catalog");
            if (catalog instanceof String s
                    && !s.isBlank())
            {
                return s;
            }
        }
        return null;
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
            int index = indexOf(target, item);
            if (index >= 0)
            {
                target.set(index, item);
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
            if (current.kind()
                    .equals(node.kind())
                    && current.name()
                            .equals(node.name()))
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

    /**
     * For each table node in the fetched list, resolve its columns via the router and attach them as children. This ensures column data is persisted in the DEEP snapshot and available for completion
     * without live JDBC queries.
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
                columns = router.resolve(connection, "table", tableTarget);
            }
            catch (RuntimeException e)
            {
                System.err.println("[WARN] Failed to resolve columns for " + tableName + ": " + e.getMessage());
                columns = List.of();
            }
            result.add(new JdbcSchemaObject(table.id(), table.name(), table.kind(), table.nodeType(), table.fullName(), List.copyOf(columns), table.attributes()));
        }
        return result;
    }
}
