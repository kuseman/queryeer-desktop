package com.queryeer.backend.plugin.jdbc.schema;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.queryeer.backend.plugin.jdbc.DefaultJdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

class JdbcSchemaCrawlerTest
{
    @Test
    void deepTablesMergeKeepsTablesUnderTheirOwnSchemas() throws SQLException
    {
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcDialect dialect = mock(JdbcDialect.class);
        JdbcSchemaResolver resolver = mock(JdbcSchemaResolver.class);
        JdbcConnection connection = new JdbcConnection("jdbc-1", "title", dialect, Map.of());

        doThrow(new RuntimeException("Some SQL error")).when(dialect)
                .openSessionConnection(anyMap());
        when(dialect.branchResolvers()).thenReturn(Map.of("tables_folder", resolver, "views_folder", resolver, "columns_folder", resolver, "indexes_folder", resolver));
        when(resolver.resolveSchema(eq(connection), argThat((Map<String, Object> args) -> "tables_folder".equals(args.get("parentKind")))))
                .thenReturn(List.of(new JdbcSchemaObject("AdventureWorks2022.Person.Address", "Address", "table", List.of(), Map.of("catalog", "AdventureWorks2022", "schema", "Person")),
                        new JdbcSchemaObject("AdventureWorks2022.HumanResources.Employee", "Employee", "table", List.of(), Map.of("catalog", "AdventureWorks2022", "schema", "HumanResources"))));
        when(resolver.resolveSchema(eq(connection), argThat((Map<String, Object> args) -> "views_folder".equals(args.get("parentKind"))))).thenReturn(List.of());

        JdbcSchemaRouter router = new JdbcSchemaRouter(new DefaultJdbcSchemaResolver());
        JdbcSchemaCrawler crawler = new JdbcSchemaCrawler(store, router);

        crawler.crawl(connection, JdbcSchemaCrawlScope.DEEP, new JdbcSchemaTarget("AdventureWorks2022", null, null));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<JdbcSchemaObject>> fetchedCaptor = ArgumentCaptor.forClass(List.class);
        verify(store).persistDeepSnapshotTarget(eq("jdbc-1"), eq("AdventureWorks2022"), eq(null), fetchedCaptor.capture());

        List<JdbcSchemaObject> fetched = fetchedCaptor.getValue();
        assertEquals(2, fetched.size());
        assertEquals("Person", fetched.get(0)
                .attributes()
                .get("schema"));
        assertEquals("Address", fetched.get(0)
                .name());
        assertEquals("HumanResources", fetched.get(1)
                .attributes()
                .get("schema"));
        assertEquals("Employee", fetched.get(1)
                .name());
    }

    @Test
    void deepCrawlExpandsColumnsAndIndexesAsFolderChildren() throws SQLException
    {
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcDialect dialect = mock(JdbcDialect.class);
        JdbcSchemaResolver resolver = mock(JdbcSchemaResolver.class);
        JdbcConnection connection = new JdbcConnection("jdbc-1", "title", dialect, Map.of());

        doThrow(new RuntimeException("Some SQL error")).when(dialect)
                .openSessionConnection(anyMap());
        when(dialect.branchResolvers()).thenReturn(Map.of("tables_folder", resolver, "views_folder", resolver, "columns_folder", resolver, "indexes_folder", resolver));
        JdbcSchemaObject column = new JdbcSchemaObject("column:db:dbo:users:id", "id", "column", List.of(), Map.of("type", "int", "primaryKey", true));
        JdbcSchemaObject index = new JdbcSchemaObject("index:db:dbo:users:idx_name", "idx_name", "index", List.of(), Map.of("columns", "name", "unique", false));

        when(resolver.resolveSchema(eq(connection), argThat((Map<String, Object> args) -> "columns_folder".equals(args.get("parentKind"))))).thenReturn(List.of(column));
        when(resolver.resolveSchema(eq(connection), argThat((Map<String, Object> args) -> "indexes_folder".equals(args.get("parentKind"))))).thenReturn(List.of(index));
        when(resolver.resolveSchema(eq(connection), argThat((Map<String, Object> args) -> "tables_folder".equals(args.get("parentKind")))))
                .thenReturn(List.of(new JdbcSchemaObject("table:db.dbo.users", "users", "table", List.of(), Map.of("catalog", "db", "schema", "dbo"))));

        JdbcSchemaRouter router = new JdbcSchemaRouter(new DefaultJdbcSchemaResolver());
        JdbcSchemaCrawler crawler = new JdbcSchemaCrawler(store, router);

        crawler.crawl(connection, JdbcSchemaCrawlScope.DEEP, new JdbcSchemaTarget("db", null, null));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<JdbcSchemaObject>> fetchedCaptor = ArgumentCaptor.forClass(List.class);
        verify(store).persistDeepSnapshotTarget(eq("jdbc-1"), eq("db"), eq(null), fetchedCaptor.capture());

        List<JdbcSchemaObject> fetched = fetchedCaptor.getValue();
        assertEquals(1, fetched.size());
        JdbcSchemaObject tableNode = fetched.get(0);
        assertEquals("users", tableNode.name());
        assertEquals(2, tableNode.children()
                .size());

        JdbcSchemaObject columnsFolder = tableNode.children()
                .stream()
                .filter(c -> "columns_folder".equals(c.kind()))
                .findFirst()
                .orElseThrow();
        assertEquals(1, columnsFolder.children()
                .size());
        assertEquals("id", columnsFolder.children()
                .get(0)
                .name());

        JdbcSchemaObject indexesFolder = tableNode.children()
                .stream()
                .filter(c -> "indexes_folder".equals(c.kind()))
                .findFirst()
                .orElseThrow();
        assertEquals(1, indexesFolder.children()
                .size());
        assertEquals("idx_name", indexesFolder.children()
                .get(0)
                .name());
    }
}
