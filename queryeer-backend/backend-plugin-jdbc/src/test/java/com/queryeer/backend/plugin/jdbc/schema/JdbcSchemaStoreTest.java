package com.queryeer.backend.plugin.jdbc.schema;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

class JdbcSchemaStoreTest
{
    @Test
    void persistsAndLoadsLatestSnapshot(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        JdbcSchemaObject personId = new JdbcSchemaObject("column:public:person:id", "id", "column", List.of(), Map.of());
        JdbcSchemaObject table = new JdbcSchemaObject("table:public:person", "person", "table",
                List.of(personId, new JdbcSchemaObject("pk:public:person:id", "pk_person", "primary_key", List.of(), Map.of("column", "id"))), Map.of("schema", "public"));
        JdbcSchemaObject orders = new JdbcSchemaObject("table:public:orders", "orders", "table",
                List.of(new JdbcSchemaObject("column:public:orders:person_id", "person_id", "column", List.of(), Map.of()),
                        new JdbcSchemaObject("fk:public:orders:person_id", "fk_orders_person", "foreign_key", List.of(),
                                Map.of("column", "person_id", "referencesTable", "person", "referencesColumn", "id")),
                        new JdbcSchemaObject("idx:public:orders:person_id", "idx_orders_person", "index", List.of(), Map.of("column", "person_id"))),
                Map.of("schema", "public"));
        JdbcSchemaObject schema = new JdbcSchemaObject("schema:public", "public", "schema", List.of(table), Map.of());
        JdbcSchemaObject schema2 = new JdbcSchemaObject("schema:public2", "public2", "schema", List.of(orders), Map.of());

        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(schema, schema2));

        List<JdbcSchemaObject> loaded = store.latestSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertEquals(2, loaded.size());
        Assertions.assertEquals("public", loaded.get(0)
                .name());
        Assertions.assertEquals("person", loaded.get(0)
                .children()
                .get(0)
                .name());
        List<String> referenceKinds = store.referenceKinds("conn-1");
        Assertions.assertTrue(referenceKinds.contains("primary_key_column"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_column"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_table"));
        Assertions.assertTrue(referenceKinds.contains("foreign_key_column_ref"));
        Assertions.assertTrue(referenceKinds.contains("index_column"));
    }

    @Test
    void crawlStatusForConnection_TopScope_ReturnsSingleEntryWithObjectCount(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        // Persist a TOP scope snapshot with 3 objects (2 databases + 1 schema)
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:db1", "db1", "database", List.of(), Map.of());
        JdbcSchemaObject db2 = new JdbcSchemaObject("database:db2", "db2", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.TOP, List.of(db1, db2));

        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-1", JdbcSchemaCrawlScope.TOP);

        Assertions.assertEquals(1, entries.size());
        JdbcSchemaStore.CrawlStatusEntry entry = entries.get(0);
        Assertions.assertNull(entry.databaseKey());
        Assertions.assertEquals(2, entry.objectCount());
        Assertions.assertEquals(0, entry.consecutiveFailures());
        Assertions.assertTrue(entry.enabled());
    }

    @Test
    void crawlStatusForConnection_DeepScope_ReturnsEntriesPerDatabaseWithObjectCount(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        // Persist a DEEP scope snapshot with database nodes and children
        JdbcSchemaObject col1 = new JdbcSchemaObject("col1", "id", "column", List.of(), Map.of());
        JdbcSchemaObject table1 = new JdbcSchemaObject("table1", "users", "table", List.of(col1), Map.of("schema", "public", "catalog", "mydb"));
        JdbcSchemaObject schema1 = new JdbcSchemaObject("schema:public", "public", "schema", List.of(table1), Map.of("catalog", "mydb"));
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(schema1), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(db1));

        // Record usage for the database to create a crawl_state entry
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb", Instant.now());

        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-1", JdbcSchemaCrawlScope.DEEP);

        // Should have one entry for "mydb", and the empty-key entry should be skipped
        Assertions.assertTrue(entries.size() >= 1);
        JdbcSchemaStore.CrawlStatusEntry mydbEntry = entries.stream()
                .filter(e -> "mydb".equals(e.databaseKey()))
                .findFirst()
                .orElseThrow();
        // Object count should be > 0 (database + schema + table + column = 4 objects)
        Assertions.assertTrue(mydbEntry.objectCount() > 0);
        Assertions.assertEquals(0, mydbEntry.consecutiveFailures());
    }

    @Test
    void crawlStatusForConnection_DeepScope_ReturnsDifferentCountsPerDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        // Database "small" has 2 objects (db + 1 table)
        JdbcSchemaObject smallTable = new JdbcSchemaObject("table:small:t1", "t1", "table", List.of(), Map.of("schema", "public", "catalog", "small"));
        JdbcSchemaObject smallSchema = new JdbcSchemaObject("schema:small:public", "public", "schema", List.of(smallTable), Map.of("catalog", "small"));
        JdbcSchemaObject smallDb = new JdbcSchemaObject("database:small", "small", "database", List.of(smallSchema), Map.of());

        // Database "large" has 5 objects (db + 2 schemas + 2 tables)
        JdbcSchemaObject largeTable1 = new JdbcSchemaObject("table:large:users", "users", "table", List.of(), Map.of("schema", "public", "catalog", "large"));
        JdbcSchemaObject largeTable2 = new JdbcSchemaObject("table:large:orders", "orders", "table", List.of(), Map.of("schema", "public", "catalog", "large"));
        JdbcSchemaObject largeSchema = new JdbcSchemaObject("schema:large:public", "public", "schema", List.of(largeTable1, largeTable2), Map.of("catalog", "large"));
        JdbcSchemaObject largeDb = new JdbcSchemaObject("database:large", "large", "database", List.of(largeSchema), Map.of());

        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(smallDb, largeDb));

        // Record usage for both databases
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "small", Instant.now());
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "large", Instant.now());

        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-1", JdbcSchemaCrawlScope.DEEP);

        // Should have entries for both databases
        Assertions.assertEquals(2, entries.size());

        JdbcSchemaStore.CrawlStatusEntry smallEntry = entries.stream()
                .filter(e -> "small".equals(e.databaseKey()))
                .findFirst()
                .orElseThrow();
        JdbcSchemaStore.CrawlStatusEntry largeEntry = entries.stream()
                .filter(e -> "large".equals(e.databaseKey()))
                .findFirst()
                .orElseThrow();

        // "large" should have more objects than "small"
        Assertions.assertTrue(largeEntry.objectCount() > smallEntry.objectCount(),
                "large db (" + largeEntry.objectCount() + ") should have more objects than small db (" + smallEntry.objectCount() + ")");
        // small: db + schema + table = 3 objects
        Assertions.assertEquals(3, smallEntry.objectCount());
        // large: db + schema + 2 tables = 4 objects
        Assertions.assertEquals(4, largeEntry.objectCount());
    }

    @Test
    void crawlStatusForConnection_DeepScope_SkipsEmptyDatabaseKey(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        // Persist a DEEP scope snapshot
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(db1));

        // Record usage for a specific database
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb", Instant.now());

        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-1", JdbcSchemaCrawlScope.DEEP);

        // No entry should have null/blank databaseKey
        boolean hasEmptyKey = entries.stream()
                .anyMatch(e -> e.databaseKey() == null
                        || e.databaseKey()
                                .isBlank());
        Assertions.assertFalse(hasEmptyKey, "DEEP scope should not include entries with empty database_key");
    }

    @Test
    void crawlStatusForConnection_NoCrawlState_ReturnsDefaultEntryForTopScope(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"));

        // Don't persist anything, just check default behavior
        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-new", JdbcSchemaCrawlScope.TOP);

        Assertions.assertEquals(1, entries.size());
        JdbcSchemaStore.CrawlStatusEntry entry = entries.get(0);
        Assertions.assertNull(entry.databaseKey());
        Assertions.assertEquals(0, entry.objectCount());
        Assertions.assertEquals(0, entry.consecutiveFailures());
        Assertions.assertTrue(entry.enabled());
    }
}
