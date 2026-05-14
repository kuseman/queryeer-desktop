package com.queryeer.backend.plugin.jdbc.schema;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
    void deepTablesMergeKeepsTablesUnderTheirOwnSchemas()
    {
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcDialect dialect = mock(JdbcDialect.class);
        JdbcSchemaResolver resolver = mock(JdbcSchemaResolver.class);
        JdbcConnection connection = new JdbcConnection("jdbc-1", "title", dialect, Map.of());

        // Wire dialect's branchResolvers to return the mock resolver for tables_folder
        when(dialect.branchResolvers()).thenReturn(Map.of("tables_folder", resolver));
        when(store.latestSnapshot("jdbc-1", JdbcSchemaCrawlScope.DEEP)).thenReturn(List.of());
        when(resolver.resolveSchema(eq(connection), anyMap()))
                .thenReturn(List.of(new JdbcSchemaObject("AdventureWorks2022.Person.Address", "Address", "table", List.of(), Map.of("catalog", "AdventureWorks2022", "schema", "Person")),
                        new JdbcSchemaObject("AdventureWorks2022.HumanResources.Employee", "Employee", "table", List.of(), Map.of("catalog", "AdventureWorks2022", "schema", "HumanResources"))));

        JdbcSchemaRouter router = new JdbcSchemaRouter(new DefaultJdbcSchemaResolver());
        JdbcSchemaCrawler crawler = new JdbcSchemaCrawler(store, router);

        crawler.crawl(connection, JdbcSchemaCrawlScope.DEEP, new JdbcSchemaTarget("AdventureWorks2022", null, null));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<JdbcSchemaObject>> snapshotCaptor = ArgumentCaptor.forClass(List.class);
        verify(store).persistSnapshot(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.DEEP), snapshotCaptor.capture());

        List<JdbcSchemaObject> roots = snapshotCaptor.getValue();
        assertEquals(1, roots.size());
        JdbcSchemaObject database = roots.get(0);
        assertEquals("database", database.kind());
        assertEquals("AdventureWorks2022", database.name());
        assertEquals(2, database.children()
                .size());
        assertEquals("Person", database.children()
                .get(0)
                .name());
        assertEquals("Address", database.children()
                .get(0)
                .children()
                .get(0)
                .name());
        assertEquals("HumanResources", database.children()
                .get(1)
                .name());
        assertEquals("Employee", database.children()
                .get(1)
                .children()
                .get(0)
                .name());
    }
}
