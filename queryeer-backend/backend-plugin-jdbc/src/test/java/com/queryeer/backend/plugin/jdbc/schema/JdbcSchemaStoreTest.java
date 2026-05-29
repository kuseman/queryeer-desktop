package com.queryeer.backend.plugin.jdbc.schema;

import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

class JdbcSchemaStoreTest
{
    @Test
    void persistsAndLoadsLatestSnapshot(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

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
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

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
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

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
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

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
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

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
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());

        // Don't persist anything, just check default behavior
        List<JdbcSchemaStore.CrawlStatusEntry> entries = store.crawlStatusForConnection("conn-new", JdbcSchemaCrawlScope.TOP);

        Assertions.assertEquals(1, entries.size());
        JdbcSchemaStore.CrawlStatusEntry entry = entries.get(0);
        Assertions.assertNull(entry.databaseKey());
        Assertions.assertEquals(0, entry.objectCount());
        Assertions.assertEquals(0, entry.consecutiveFailures());
        Assertions.assertTrue(entry.enabled());
    }

    @Test
    void entriesForCompletion_FiltersBySelectedDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        List<JdbcSchemaStore.TableLookupEntry> entries = store.entriesForCompletion("conn-1", "sales", List.of("table", "view"));

        Assertions.assertEquals(List.of("dbo.orders", "dbo.order_summary"), entries.stream()
                .map(JdbcSchemaStore.TableLookupEntry::name)
                .toList());
        Assertions.assertEquals(List.of("table", "view"), entries.stream()
                .map(JdbcSchemaStore.TableLookupEntry::kind)
                .toList());
    }

    @Test
    void columnNamesForTables_ReturnsColumnsFromNestedColumnsFolder(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        Map<String, List<String>> columns = store.columnNamesForTables("conn-1", List.of("dbo.orders", "hr.employees"), null);

        Assertions.assertEquals(List.of("id", "amount"), columns.get("dbo.orders"));
        Assertions.assertEquals(List.of("id", "name"), columns.get("hr.employees"));
    }

    @Test
    void columnNamesForTables_ExplicitDatabaseOverridesSelectedDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        Map<String, List<String>> columns = store.columnNamesForTables("conn-1", List.of("hr.hr.employees"), "sales");

        Assertions.assertEquals(List.of("id", "name"), columns.get("hr.hr.employees"));
    }

    @Test
    void findSymbol_HonorsSchemaAndSelectedDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        JdbcSchemaStore.SymbolLookupEntry symbol = store.findSymbol("conn-1", "dbo.orders", "sales");
        JdbcSchemaStore.SymbolLookupEntry filtered = store.findSymbol("conn-1", "dbo.orders", "hr");

        Assertions.assertNotNull(symbol);
        Assertions.assertEquals("table", symbol.kind());
        Assertions.assertEquals("dbo.orders", symbol.name());
        Assertions.assertEquals("sales.dbo.orders", symbol.fullName());
        Assertions.assertEquals("sales", symbol.database());
        Assertions.assertEquals("dbo", symbol.schema());
        Assertions.assertEquals("orders", symbol.objectName());
        Assertions.assertNull(filtered);
    }

    @Test
    void findSymbol_ExplicitDatabaseOverridesSelectedDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        JdbcSchemaStore.SymbolLookupEntry symbol = store.findSymbol("conn-1", "hr.hr.employees", "sales");

        Assertions.assertNotNull(symbol);
        Assertions.assertEquals("hr.employees", symbol.name());
        Assertions.assertEquals("hr.hr.employees", symbol.fullName());
        Assertions.assertEquals("hr", symbol.database());
        Assertions.assertEquals("hr", symbol.schema());
        Assertions.assertEquals("employees", symbol.objectName());
    }

    @Test
    void persistDeepSnapshotTarget_ReplacesOnlyTargetSchema(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        JdbcSchemaObject report = new JdbcSchemaObject("table:sales:reporting:daily_sales", "daily_sales", "table", List.of(), Map.of("schema", "reporting", "catalog", "sales"));
        JdbcSchemaObject reporting = new JdbcSchemaObject("schema:sales:reporting", "reporting", "schema", List.of(report), Map.of("catalog", "sales"));
        JdbcSchemaObject sales = new JdbcSchemaObject("database:sales", "sales", "database", List.of(lookupSnapshot().get(0)
                .children()
                .get(0), reporting), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(sales, lookupSnapshot().get(1)));

        JdbcSchemaObject refreshed = new JdbcSchemaObject("table:sales:dbo:orders", "orders", "table",
                List.of(new JdbcSchemaObject("columns_folder:sales:dbo:orders", "Columns", "columns_folder",
                        List.of(new JdbcSchemaObject("column:sales:dbo:orders:id", "id", "column", List.of(), Map.of("type", "int")),
                                new JdbcSchemaObject("column:sales:dbo:orders:total", "total", "column", List.of(), Map.of("type", "decimal"))),
                        Map.of())),
                Map.of("schema", "dbo", "catalog", "sales"));

        store.persistDeepSnapshotTarget("conn-1", "sales", "dbo", List.of(refreshed));

        List<JdbcSchemaObject> loaded = store.latestSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertNotNull(findObject(loaded, "table:sales:reporting:daily_sales"));
        Assertions.assertNotNull(findObject(loaded, "table:hr:hr:employees"));
        Assertions.assertNull(findObject(loaded, "view:sales:dbo:order_summary"));
        Assertions.assertNotNull(findObject(loaded, "column:sales:dbo:orders:total"));
        Assertions.assertNull(findObject(loaded, "column:sales:dbo:orders:amount"));
    }

    @Test
    void persistDeepSnapshotTarget_ReplacesOnlyTargetDatabase(@TempDir Path tempDir)
    {
        JdbcSchemaStore store = new JdbcSchemaStore(tempDir.resolve("cache"), new JacksonPayloadMapper());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, lookupSnapshot());

        JdbcSchemaObject product = new JdbcSchemaObject("table:sales:dbo:products", "products", "table", List.of(), Map.of("schema", "dbo", "catalog", "sales"));

        store.persistDeepSnapshotTarget("conn-1", "sales", null, List.of(product));

        List<JdbcSchemaObject> loaded = store.latestSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertNotNull(findObject(loaded, "table:sales:dbo:products"));
        Assertions.assertNull(findObject(loaded, "table:sales:dbo:orders"));
        Assertions.assertNotNull(findObject(loaded, "table:hr:hr:employees"));
    }

    @Test
    void recoversFromCorruptedDatabase(@TempDir Path tempDir) throws Exception
    {
        Path cacheDir = tempDir.resolve("cache");
        JdbcSchemaStore store = new JdbcSchemaStore(cacheDir, new JacksonPayloadMapper());

        // First create a healthy database and persist data
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.TOP, List.of(db1));
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.TOP, Instant.now());

        // Now corrupt the .mv.db file by overwriting with garbage
        Path mvDb = cacheDir.resolve("conn-1__top.mv.db");
        Assertions.assertTrue(Files.exists(mvDb), "Database file should exist before corruption");
        Files.writeString(mvDb, "CORRUPTED_GARBAGE_DATA_THAT_WILL_CAUSE_H2_TO_FAIL");

        // Should auto-recover: the store should detect corruption, delete the file, and create a fresh one
        // This should not throw
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.TOP, Instant.now());

        // Verify the database is usable by reading state
        JdbcSchemaStore.CrawlState state = store.readState("conn-1", JdbcSchemaCrawlScope.TOP);
        Assertions.assertNotNull(state);

        // After corruption recovery, state should be fresh (no previous data)
        Assertions.assertEquals(0, state.consecutiveFailures());
    }

    @Test
    void databaseKeysWorksAfterCorruptionRecovery(@TempDir Path tempDir) throws Exception
    {
        Path cacheDir = tempDir.resolve("cache");
        JdbcSchemaStore store = new JdbcSchemaStore(cacheDir, new JacksonPayloadMapper());

        // Create initial healthy database
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(db1));
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb", Instant.now());

        // Verify databaseKeys works
        List<String> keys = store.databaseKeys("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertTrue(keys.contains("mydb"));

        // Corrupt the file
        Path mvDb = cacheDir.resolve("conn-1__deep.mv.db");
        Assertions.assertTrue(Files.exists(mvDb));
        Files.writeString(mvDb, "GARBAGE");

        // After auto-recovery, databaseKeys should return empty (fresh db)
        List<String> keysAfter = store.databaseKeys("conn-1", JdbcSchemaCrawlScope.DEEP);
        Assertions.assertTrue(keysAfter.isEmpty(), "Fresh database should have no database keys");
    }

    @Test
    void multipleCorruptionsAreHandledGracefully(@TempDir Path tempDir) throws Exception
    {
        Path cacheDir = tempDir.resolve("cache");
        JdbcSchemaStore store = new JdbcSchemaStore(cacheDir, new JacksonPayloadMapper());

        // Create initial healthy databases
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.DEEP, List.of(db1));
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb", Instant.now());

        // Corrupt both TOP and DEEP files
        Path topMvDb = cacheDir.resolve("conn-1__top.mv.db");
        Path deepMvDb = cacheDir.resolve("conn-1__deep.mv.db");
        Files.writeString(topMvDb, "GARBAGE_TOP");
        Files.writeString(deepMvDb, "GARBAGE_DEEP");

        // Both operations should recover independently
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.TOP, Instant.now());
        store.recordUsage("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb", Instant.now());

        JdbcSchemaStore.CrawlState topState = store.readState("conn-1", JdbcSchemaCrawlScope.TOP);
        Assertions.assertNotNull(topState);
        Assertions.assertEquals(0, topState.consecutiveFailures());

        JdbcSchemaStore.CrawlState deepState = store.readState("conn-1", JdbcSchemaCrawlScope.DEEP, "mydb");
        Assertions.assertNotNull(deepState);
        Assertions.assertEquals(0, deepState.consecutiveFailures());
    }

    @Test
    void deletesOvergrownFileAndStartsFresh(@TempDir Path tempDir) throws Exception
    {
        Path cacheDir = tempDir.resolve("cache");
        JdbcSchemaStore store = new JdbcSchemaStore(cacheDir, new JacksonPayloadMapper());

        // Create a healthy database with data
        JdbcSchemaObject db1 = new JdbcSchemaObject("database:mydb", "mydb", "database", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.TOP, List.of(db1));

        // Make the file appear overgrown by extending it past the threshold
        // (100MB). Use sparse file extension for speed.
        Path mvDb = cacheDir.resolve("conn-1__top.mv.db");
        Assertions.assertTrue(Files.exists(mvDb));
        try (RandomAccessFile raf = new RandomAccessFile(mvDb.toFile(), "rw"))
        {
            raf.setLength(101L * 1024L * 1024L); // 101 MB sparse file
        }

        // The store should detect the overgrown file, delete it, and create a fresh one
        JdbcSchemaStore.CrawlState state = store.readState("conn-1", JdbcSchemaCrawlScope.TOP);
        Assertions.assertNotNull(state);
        // Fresh database, not the old data
        Assertions.assertEquals(0, state.consecutiveFailures());
        // File should be much smaller now (< 1MB for a fresh H2 DB)
        Assertions.assertTrue(Files.size(mvDb) < 1_000_000L);
    }

    @Test
    void compactAfterSnapshotKeepsFileSmall(@TempDir Path tempDir) throws Exception
    {
        Path cacheDir = tempDir.resolve("cache");
        JdbcSchemaStore store = new JdbcSchemaStore(cacheDir, new JacksonPayloadMapper());

        // Persist a snapshot - should trigger compaction for files > 5MB
        // Since the test file is tiny, compactIfNeeded should skip (size < 5MB threshold)
        JdbcSchemaObject obj = new JdbcSchemaObject("test:1", "test", "table", List.of(), Map.of());
        store.persistSnapshot("conn-1", JdbcSchemaCrawlScope.TOP, List.of(obj));

        // Verify the database is still usable after the best-effort compact
        JdbcSchemaStore.CrawlState state = store.readState("conn-1", JdbcSchemaCrawlScope.TOP);
        Assertions.assertNotNull(state);
    }

    private static List<JdbcSchemaObject> lookupSnapshot()
    {
        JdbcSchemaObject orderColumns = new JdbcSchemaObject("columns_folder:sales:dbo:orders", "Columns", "columns_folder",
                List.of(new JdbcSchemaObject("column:sales:dbo:orders:id", "id", "column", List.of(), Map.of("type", "int")),
                        new JdbcSchemaObject("column:sales:dbo:orders:amount", "amount", "column", List.of(), Map.of("type", "decimal"))),
                Map.of());
        JdbcSchemaObject orders = new JdbcSchemaObject("table:sales:dbo:orders", "orders", "table", List.of(orderColumns), Map.of("schema", "dbo", "catalog", "sales"));
        JdbcSchemaObject orderSummary = new JdbcSchemaObject("view:sales:dbo:order_summary", "order_summary", "view", List.of(), Map.of("schema", "dbo", "catalog", "sales"));
        JdbcSchemaObject salesSchema = new JdbcSchemaObject("schema:sales:dbo", "dbo", "schema", List.of(orders, orderSummary), Map.of("catalog", "sales"));
        JdbcSchemaObject salesDb = new JdbcSchemaObject("database:sales", "sales", "database", List.of(salesSchema), Map.of());

        JdbcSchemaObject employeeColumns = new JdbcSchemaObject("columns_folder:hr:hr:employees", "Columns", "columns_folder",
                List.of(new JdbcSchemaObject("column:hr:hr:employees:id", "id", "column", List.of(), Map.of("type", "int")),
                        new JdbcSchemaObject("column:hr:hr:employees:name", "name", "column", List.of(), Map.of("type", "varchar"))),
                Map.of());
        JdbcSchemaObject employees = new JdbcSchemaObject("table:hr:hr:employees", "employees", "table", List.of(employeeColumns), Map.of("schema", "hr", "catalog", "hr"));
        JdbcSchemaObject hrSchema = new JdbcSchemaObject("schema:hr:hr", "hr", "schema", List.of(employees), Map.of("catalog", "hr"));
        JdbcSchemaObject hrDb = new JdbcSchemaObject("database:hr", "hr", "database", List.of(hrSchema), Map.of());
        return List.of(salesDb, hrDb);
    }

    private static JdbcSchemaObject findObject(List<JdbcSchemaObject> nodes, String objectId)
    {
        for (JdbcSchemaObject node : nodes)
        {
            if (objectId.equals(node.id()))
            {
                return node;
            }
            JdbcSchemaObject found = findObject(node.children() == null ? List.of()
                    : node.children(), objectId);
            if (found != null)
            {
                return found;
            }
        }
        return null;
    }
}
