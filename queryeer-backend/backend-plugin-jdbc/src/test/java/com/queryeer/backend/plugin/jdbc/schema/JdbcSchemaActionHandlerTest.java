package com.queryeer.backend.plugin.jdbc.schema;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.plugin.jdbc.DefaultJdbcSchemaResolver;
import com.queryeer.backend.plugin.jdbc.TestPayloadMapper;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcTreeBranch;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.NodeType;

class JdbcSchemaActionHandlerTest
{
    @Test
    void fetchWithConnectionParentKindMergesDialectTreeBranches() throws Exception
    {
        JdbcDialect dialect = mock(JdbcDialect.class);
        when(dialect.treeBranches()).thenReturn(List.of(new JdbcTreeBranch("connection", "security_container", NodeType.CONTAINER, "Security", null),
                new JdbcTreeBranch("security_container", "users_folder", NodeType.FOLDER, "Users", null)));
        JdbcConnection connection = new JdbcConnection("conn-1", "test", dialect, Map.of());
        JdbcSchemaResolver connectionResolver = mock(JdbcSchemaResolver.class);
        when(connectionResolver.resolveSchema(connection, Map.of("parentKind", "databases_container")))
                .thenReturn(List.of(new JdbcSchemaObject("__databases__", "Databases", "databases_container", null, Map.of())));
        when(dialect.branchResolvers()).thenReturn(Map.of("databases_container", connectionResolver));

        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        when(connections.resolve("conn-1")).thenReturn(connection);

        JdbcSchemaRouter router = new JdbcSchemaRouter(new DefaultJdbcSchemaResolver());
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlCoordinator coordinator = mock(JdbcSchemaCrawlCoordinator.class);
        JdbcConnectionHealth health = new JdbcConnectionHealth();
        JdbcSchemaActionHandler handler = new JdbcSchemaActionHandler(TestPayloadMapper.INSTANCE, connections, router, store, coordinator, health);

        // This must NOT throw UnsupportedOperationException (regression test)
        Object result = handler.fetch(Map.of("connectionId", "conn-1", "parentKind", "connection"));

        assertTrue(result instanceof List);
        @SuppressWarnings("unchecked")
        List<JdbcSchemaObject> items = (List<JdbcSchemaObject>) result;
        assertTrue(items.stream()
                .anyMatch(i -> "security_container".equals(i.kind())));
        assertEquals(2, items.size()); // databases_container + security_container
    }
}
