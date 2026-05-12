package com.queryeer.backend.plugin.jdbc.schema;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaActionHandler
{
    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_DEEP = "deep";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    private static final String DEFAULT_DATABASE_NODE = "default";

    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";

    private static final String ERROR_CONNECTION_ID_REQUIRED = "connectionId is required";
    private static final String ERROR_TARGET_SCHEMA_REQUIRED = "target.schema is required for scope=deep";

    private final PayloadMapper payloadMapper;
    private final DefaultJdbcConnections connections;
    private final JdbcSchemaStore schemaStore;
    private final JdbcSchemaCrawlCoordinator crawlCoordinator;
    private final ExecutorService persistExecutor;
    private final Set<PersistTaskKey> pendingPersistKeys;

    public JdbcSchemaActionHandler(PayloadMapper payloadMapper, DefaultJdbcConnections connections, JdbcSchemaStore schemaStore, JdbcSchemaCrawlCoordinator crawlCoordinator)
    {
        this.payloadMapper = payloadMapper;
        this.connections = connections;
        this.schemaStore = schemaStore;
        this.crawlCoordinator = crawlCoordinator;
        this.persistExecutor = Executors.newSingleThreadExecutor(r ->
        {
            Thread thread = new Thread(r, "jdbc-schema-fetch-persist");
            thread.setDaemon(true);
            return thread;
        });
        this.pendingPersistKeys = ConcurrentHashMap.newKeySet();
    }

    public Object fetch(Object payload)
    {
        JdbcSchemaFetchPayload params = payloadMapper.convert(payload, JdbcSchemaFetchPayload.class);
        JdbcConnection resolved = connections.resolve(params.connectionId());

        Map<String, Object> options = new java.util.HashMap<>();
        if (params.scope() != null)
        {
            options.put(OPTION_SCOPE, params.scope());
        }
        if (params.target() != null)
        {
            options.put(OPTION_TARGET, params.target());
        }

        List<JdbcSchemaObject> result = resolved.dialect()
                .schemaResolver()
                .resolveSchema(resolved, options);
        persistDeepCacheFromFetchAsync(resolved.connectionId(), params, result);
        return result;
    }

    private void persistDeepCacheFromFetchAsync(String connectionId, JdbcSchemaFetchPayload params, List<JdbcSchemaObject> fetched)
    {
        PersistTaskKey key = persistTaskKey(connectionId, params);
        if (!pendingPersistKeys.add(key))
        {
            return;
        }

        persistExecutor.submit(() ->
        {
            try
            {
                persistDeepCacheFromFetch(connectionId, params, fetched);
            }
            finally
            {
                pendingPersistKeys.remove(key);
            }
        });
    }

    private static PersistTaskKey persistTaskKey(String connectionId, JdbcSchemaFetchPayload params)
    {
        String scope = trimToNull(params.scope());
        JdbcSchemaTarget target = params.target();
        String database = target != null ? trimToNull(target.database())
                : null;
        String schema = target != null ? trimToNull(target.schema())
                : null;
        String table = target != null ? trimToNull(target.table())
                : null;
        return new PersistTaskKey(connectionId, scope, database, schema, table);
    }

    private record PersistTaskKey(String connectionId, String scope, String database, String schema, String table)
    {
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
        JdbcSchemaCrawlScope crawlScope = SCOPE_DEEP.equalsIgnoreCase(scope) ? JdbcSchemaCrawlScope.DEEP
                : JdbcSchemaCrawlScope.TOP;
        List<JdbcSchemaObject> snapshot = schemaStore.latestSnapshot(connectionId, crawlScope);
        if (!snapshot.isEmpty()
                || crawlScope != JdbcSchemaCrawlScope.TOP)
        {
            return snapshot;
        }

        try
        {
            return crawlCoordinator.refreshNow(connectionId, JdbcSchemaCrawlScope.TOP, null);
        }
        catch (RuntimeException e)
        {
            return snapshot;
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
                || SCOPE_TOP.equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.TOP;
        }
        else if (SCOPE_DEEP.equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.DEEP;
        }
        else
        {
            throw new IllegalArgumentException("scope must be one of: " + SCOPE_TOP + ", " + SCOPE_DEEP);
        }

        JdbcSchemaTarget target = null;
        if (crawlScope == JdbcSchemaCrawlScope.DEEP)
        {
            JdbcSchemaTarget incomingTarget = params.target();
            String schema = incomingTarget != null ? trimToNull(incomingTarget.schema())
                    : null;
            if (schema == null)
            {
                throw new IllegalArgumentException(ERROR_TARGET_SCHEMA_REQUIRED);
            }

            target = new JdbcSchemaTarget(incomingTarget != null ? trimToNull(incomingTarget.database())
                    : null, schema);

            JdbcConnection resolved = connections.resolve(connectionId);
            List<JdbcSchemaObject> fetched = resolved.dialect()
                    .schemaResolver()
                    .resolveSchema(resolved, Map.of(OPTION_SCOPE, SCOPE_TABLES, OPTION_TARGET, target));
            List<JdbcSchemaObject> current = new ArrayList<>(schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP));
            mergeTablesScope(current, target.database(), target.schema(), fetched);
            schemaStore.persistSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP, current);
            return current;
        }

        return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
    }

    private void persistDeepCacheFromFetch(String connectionId, JdbcSchemaFetchPayload params, List<JdbcSchemaObject> fetched)
    {
        if (fetched == null
                || fetched.isEmpty())
        {
            return;
        }

        String scope = trimToNull(params.scope());
        if (!SCOPE_TABLES.equalsIgnoreCase(scope)
                && !SCOPE_COLUMNS.equalsIgnoreCase(scope))
        {
            return;
        }

        try
        {
            List<JdbcSchemaObject> current = new ArrayList<>(schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP));
            JdbcSchemaTarget target = params.target();
            String database = target != null ? trimToNull(target.database())
                    : null;
            String schema = target != null ? trimToNull(target.schema())
                    : null;
            String table = target != null ? trimToNull(target.table())
                    : null;

            if (SCOPE_TABLES.equalsIgnoreCase(scope))
            {
                mergeTablesScope(current, database, schema, fetched);
            }
            else
            {
                mergeColumnsScope(current, database, schema, table, fetched);
            }

            schemaStore.persistSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP, current);
        }
        catch (RuntimeException ignored)
        {
        }
    }

    private static void mergeTablesScope(List<JdbcSchemaObject> roots, String database, String schema, List<JdbcSchemaObject> fetched)
    {
        String db = database != null ? database
                : inferDatabase(fetched);
        if (db == null)
        {
            db = DEFAULT_DATABASE_NODE;
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

    private static void mergeColumnsScope(List<JdbcSchemaObject> roots, String database, String schema, String table, List<JdbcSchemaObject> fetched)
    {
        String db = database != null ? database
                : inferDatabase(fetched);
        if (db == null)
        {
            db = DEFAULT_DATABASE_NODE;
        }
        if (schema == null
                || table == null)
        {
            return;
        }

        JdbcSchemaObject dbNode = upsertChild(roots, new JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<JdbcSchemaObject> dbChildren = mutableChildren(dbNode);
        JdbcSchemaObject schemaNode = upsertChild(dbChildren, new JdbcSchemaObject(db + "." + schema, schema, "schema", List.of(), Map.of("catalog", db)));
        List<JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
        JdbcSchemaObject tableNode = upsertChild(schemaChildren, new JdbcSchemaObject(db + "." + schema + "." + table, table, "table", List.of(), Map.of("catalog", db, "schema", schema)));
        List<JdbcSchemaObject> tableChildren = mutableChildren(tableNode);
        mergeInto(tableChildren, fetched);
        replaceNode(schemaChildren, tableNode, withChildren(tableNode, tableChildren));
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
        return new java.util.ArrayList<>(node.children() == null ? List.of()
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
        int index = indexOf(target, candidate);
        if (index >= 0)
        {
            return target.get(index);
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
        int index = indexOf(list, oldNode);
        if (index >= 0)
        {
            list.set(index, updatedNode);
        }
    }

    private static String trimToNull(String value)
    {
        if (value == null)
        {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }
}
