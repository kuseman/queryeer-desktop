package com.queryeer.backend.plugin.jdbc.sqlite;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

class SqliteDialectTest
{
    private SqliteDialect dialect;

    @BeforeEach
    void setUp()
    {
        dialect = new SqliteDialect();
    }

    // -- buildUrl --

    @Test
    void buildUrlReturnsSqliteJdbcUrl()
    {
        String url = dialect.buildUrl(Map.of("filePath", "/data/mydb.sqlite"));
        assertEquals("jdbc:sqlite:/data/mydb.sqlite", url);
    }

    @Test
    void buildUrlReturnsNullWhenFilePathIsMissing()
    {
        String url = dialect.buildUrl(Map.of());
        assertNull(url);
    }

    @Test
    void buildUrlReturnsNullWhenFilePathIsNull()
    {
        var props = new HashMap<String, Object>();
        props.put("filePath", null);
        String url = dialect.buildUrl(props);
        assertNull(url);
    }

    @Test
    void buildUrlHandlesWindowsPath()
    {
        String url = dialect.buildUrl(Map.of("filePath", "C:\\data\\mydb.sqlite"));
        assertEquals("jdbc:sqlite:C:\\data\\mydb.sqlite", url);
    }

    // -- metadata --

    @Test
    void metadataHasCorrectDialectId()
    {
        assertEquals("sqlite", dialect.metadata()
                .id());
    }

    @Test
    void metadataHasCorrectDisplayName()
    {
        assertEquals("SQLite", dialect.metadata()
                .displayName());
    }

    @Test
    void metadataHasCorrectDriverClassName()
    {
        assertEquals("org.sqlite.JDBC", dialect.metadata()
                .driverClassName());
    }

    @Test
    void metadataHasSqliteJdbcUrlTemplate()
    {
        assertEquals("jdbc:sqlite:{file}", dialect.metadata()
                .jdbcUrlTemplate());
    }

    // -- canSwitchDatabase --

    @Test
    void canSwitchDatabaseReturnsFalse()
    {
        assertFalse(dialect.canSwitchDatabase());
    }

    // -- applyDatabase / resolveCurrentDatabase --

    @Test
    void applyDatabaseDoesNothing()
    {
        // Must not throw regardless of arguments
        dialect.applyDatabase(null, "anything");
    }

    @Test
    void resolveCurrentDatabaseReturnsNull()
    {
        assertNull(dialect.resolveCurrentDatabase(null));
    }

    // -- queryExecutor --

    @Test
    void queryExecutorReturnsNonNull()
    {
        assertNotNull(dialect.queryExecutor());
    }

    // -- sqlGrammarId --

    @Test
    void sqlGrammarIdIsNotNull()
    {
        assertNotNull(dialect.sqlGrammarId());
    }

    // -- extractErrorDetails --

    @Test
    void extractErrorDetailsReturnsEmptyMapForNull()
    {
        assertTrue(dialect.extractErrorDetails(null)
                .isEmpty());
    }

    @Test
    void extractErrorDetailsReturnsEmptyMapForException()
    {
        assertTrue(dialect.extractErrorDetails(new RuntimeException())
                .isEmpty());
    }

    // -- branchResolvers --

    @Test
    void branchResolversContainsExpectedKeys()
    {
        Map<String, JdbcSchemaResolver> resolvers = dialect.branchResolvers();
        Set<String> expectedKeys = Set.of("connection", "databases_container", "database", "schemas_container", "tables_folder", "views_folder", "table", "view", "columns_folder", "indexes_folder",
                "procedures_folder", "triggers_folder");
        assertEquals(expectedKeys, resolvers.keySet());
    }

    // -- resolveEmpty (procedures_folder / triggers_folder) --

    @Test
    void resolveProceduresFolderReturnsEmpty(@TempDir Path tempDir) throws Exception
    {
        JdbcConnection conn = createTempDbConnection(tempDir);
        Map<String, JdbcSchemaResolver> resolvers = dialect.branchResolvers();
        List<JdbcSchemaObject> result = resolvers.get("procedures_folder")
                .resolveSchema(conn, Map.of());
        assertTrue(result.isEmpty());
    }

    @Test
    void resolveTriggersFolderReturnsEmpty(@TempDir Path tempDir) throws Exception
    {
        JdbcConnection conn = createTempDbConnection(tempDir);
        Map<String, JdbcSchemaResolver> resolvers = dialect.branchResolvers();
        List<JdbcSchemaObject> result = resolvers.get("triggers_folder")
                .resolveSchema(conn, Map.of());
        assertTrue(result.isEmpty());
    }

    // -- resolveDatabasesContainer --

    @Test
    void resolveDatabasesContainerReturnsDefaultDatabase()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("databases_container")
                .resolveSchema(null, Map.of());
        assertEquals(1, result.size());
        JdbcSchemaObject container = result.get(0);
        assertEquals("__databases__", container.id());
        assertEquals("Databases", container.name());
        assertEquals("databases_container", container.kind());
        List<JdbcSchemaObject> databases = container.children();
        assertNotNull(databases);
        assertEquals(1, databases.size());
        assertEquals("database:default", databases.get(0)
                .id());
    }

    // -- resolveDatabase --

    @Test
    void resolveDatabaseReturnsDefaultSchemaContainer()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("database")
                .resolveSchema(null, Map.of());
        assertEquals(1, result.size());
        JdbcSchemaObject container = result.get(0);
        assertEquals("__schemas__:default", container.id());
        assertEquals("Schemas", container.name());
        assertEquals("schemas_container", container.kind());
    }

    // -- resolveSchemasContainer --

    @Test
    void resolveSchemasContainerReturnsDefaultSchema()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("schemas_container")
                .resolveSchema(null, Map.of());
        assertEquals(1, result.size());
        JdbcSchemaObject schema = result.get(0);
        assertEquals("schema:default|default", schema.id());
        assertEquals("default", schema.name());
        assertEquals("schema", schema.kind());
    }

    // -- resolveTableFolders (table / view) --

    @Test
    void resolveTableFoldersReturnsColumnsAndIndexesFolders()
    {
        JdbcSchemaTarget target = new JdbcSchemaTarget(null, null, "my_table");
        Map<String, Object> options = Map.of("target", target);
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("table")
                .resolveSchema(null, options);
        assertEquals(2, result.size());
        assertEquals("columns_folder", result.get(0)
                .kind());
        assertEquals("indexes_folder", result.get(1)
                .kind());
    }

    @Test
    void resolveTableFoldersReturnsEmptyWhenTableIsNull()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("table")
                .resolveSchema(null, Map.of());
        assertTrue(result.isEmpty());
    }

    // -- openSessionConnection / resolver integration (real SQLite DB) --

    @Test
    void openSessionConnectsToTempFile(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("test.db");
        Map<String, Object> props = Map.of("filePath", dbFile.toString());
        try (Connection conn = dialect.openSessionConnection(props))
        {
            assertNotNull(conn);
            assertFalse(conn.isClosed());
        }
    }

    @Test
    void resolveTablesAfterCreate(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = createTable(tempDir, "CREATE TABLE my_table (id INTEGER PRIMARY KEY, name TEXT)");
        JdbcConnection conn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));

        List<JdbcSchemaObject> tables = dialect.branchResolvers()
                .get("tables_folder")
                .resolveSchema(conn, Map.of());

        assertEquals(1, tables.size());
        assertEquals("table:my_table", tables.get(0)
                .id());
        assertEquals("my_table", tables.get(0)
                .name());
    }

    @Test
    void resolveTablesReturnsMultipleTables(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("multi.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute("CREATE TABLE t1 (a INTEGER)");
            stmt.execute("CREATE TABLE t2 (b TEXT)");
        }

        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        List<JdbcSchemaObject> tables = dialect.branchResolvers()
                .get("tables_folder")
                .resolveSchema(jdbcConn, Map.of());

        assertEquals(2, tables.size());
    }

    @Test
    void resolveTablesFiltersSqliteInternalTables(@TempDir Path tempDir) throws Exception
    {
        // sqlite_% tables should be filtered out by the query
        Path dbFile = tempDir.resolve("internal.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute("CREATE TABLE my_data (id INTEGER)");
        }

        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        List<JdbcSchemaObject> tables = dialect.branchResolvers()
                .get("tables_folder")
                .resolveSchema(jdbcConn, Map.of());

        assertTrue(tables.stream()
                .anyMatch(t -> "my_data".equals(t.name())));
    }

    @Test
    void resolveConnectionRootReturnsTablesAndViews(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("root.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute("CREATE TABLE my_table (id INTEGER)");
            stmt.execute("CREATE VIEW my_view AS SELECT * FROM my_table");
        }

        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("connection")
                .resolveSchema(jdbcConn, Map.of());

        // Should have both Tables and Views folders
        assertEquals(2, result.size());
        assertEquals("tables_folder", result.get(0)
                .kind());
        assertEquals("views_folder", result.get(1)
                .kind());
        assertEquals("my_table", result.get(0)
                .children()
                .get(0)
                .name());
        assertEquals("my_view", result.get(1)
                .children()
                .get(0)
                .name());
    }

    @Test
    void resolveConnectionRootOmitsViewsFolderWhenNoViews(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = createTable(tempDir, "CREATE TABLE my_table (id INTEGER)");
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));

        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("connection")
                .resolveSchema(jdbcConn, Map.of());

        assertEquals(1, result.size());
        assertEquals("tables_folder", result.get(0)
                .kind());
    }

    @Test
    void resolveColumnsReturnsColumnInfo(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = createTable(tempDir, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score REAL DEFAULT 0.0)");
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        JdbcSchemaTarget target = new JdbcSchemaTarget(null, null, "t");
        Map<String, Object> options = Map.of("target", target);

        List<JdbcSchemaObject> columns = dialect.branchResolvers()
                .get("columns_folder")
                .resolveSchema(jdbcConn, options);

        assertEquals(3, columns.size());
        // id column - primary key
        assertEquals("column:t:id", columns.get(0)
                .id());
        assertEquals("id", columns.get(0)
                .name());
        assertEquals("integer", columns.get(0)
                .attributes()
                .get("type"));
        assertTrue((boolean) columns.get(0)
                .attributes()
                .get("primaryKey"));
        // name column - not null
        assertEquals("name", columns.get(1)
                .name());
        assertEquals("text", columns.get(1)
                .attributes()
                .get("type"));
        assertFalse((boolean) columns.get(1)
                .attributes()
                .get("nullable"));
        // score column - has default
        assertEquals("score", columns.get(2)
                .name());
        assertEquals("real", columns.get(2)
                .attributes()
                .get("type"));
        assertEquals("0.0", columns.get(2)
                .attributes()
                .get("defaultValue"));
    }

    @Test
    void resolveColumnsReturnsEmptyForMissingTable(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("missing_table.db");
        // sqlite-jdbc creates the file on connection
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        JdbcSchemaTarget target = new JdbcSchemaTarget(null, null, "no_such_table");
        Map<String, Object> options = Map.of("target", target);

        List<JdbcSchemaObject> columns = dialect.branchResolvers()
                .get("columns_folder")
                .resolveSchema(jdbcConn, options);

        assertTrue(columns.isEmpty());
    }

    @Test
    void resolveColumnsReturnsEmptyForNullTable()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("columns_folder")
                .resolveSchema(null, Map.of());
        assertTrue(result.isEmpty());
    }

    @Test
    void resolveIndexesAfterCreate(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("indexed.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
            stmt.execute("CREATE INDEX idx_val ON t(val)");
        }

        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        JdbcSchemaTarget target = new JdbcSchemaTarget(null, null, "t");
        Map<String, Object> options = Map.of("target", target);

        List<JdbcSchemaObject> indexes = dialect.branchResolvers()
                .get("indexes_folder")
                .resolveSchema(jdbcConn, options);

        assertEquals(1, indexes.size());
        assertEquals("idx_val", indexes.get(0)
                .name());
    }

    @Test
    void resolveIndexesReturnsEmptyForTableWithoutIndexes(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = createTable(tempDir, "CREATE TABLE t (id INTEGER)");
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
        JdbcSchemaTarget target = new JdbcSchemaTarget(null, null, "t");
        Map<String, Object> options = Map.of("target", target);

        List<JdbcSchemaObject> indexes = dialect.branchResolvers()
                .get("indexes_folder")
                .resolveSchema(jdbcConn, options);

        assertTrue(indexes.isEmpty());
    }

    @Test
    void resolveIndexesReturnsEmptyForNullTable()
    {
        List<JdbcSchemaObject> result = dialect.branchResolvers()
                .get("indexes_folder")
                .resolveSchema(null, Map.of());
        assertTrue(result.isEmpty());
    }

    @Test
    void resolveViewsAfterCreate(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("views.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute("CREATE TABLE t (id INTEGER)");
            stmt.execute("CREATE VIEW v AS SELECT * FROM t");
        }
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));

        List<JdbcSchemaObject> views = dialect.branchResolvers()
                .get("views_folder")
                .resolveSchema(jdbcConn, Map.of());

        assertEquals(1, views.size());
        assertEquals("view:v", views.get(0)
                .id());
    }

    @Test
    void resolveViewsReturnsEmptyWhenNoViews(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = createTable(tempDir, "CREATE TABLE t (id INTEGER)");
        JdbcConnection jdbcConn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));

        List<JdbcSchemaObject> views = dialect.branchResolvers()
                .get("views_folder")
                .resolveSchema(jdbcConn, Map.of());

        assertTrue(views.isEmpty());
    }

    // -- error paths --

    @Test
    void resolveTablesReturnsEmptyForEmptyDatabase(@TempDir Path tempDir) throws Exception
    {
        Path dbFile = tempDir.resolve("empty.db");
        // sqlite-jdbc creates the file on first connection
        JdbcConnection conn = new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));

        List<JdbcSchemaObject> tables = dialect.branchResolvers()
                .get("tables_folder")
                .resolveSchema(conn, Map.of());

        assertTrue(tables.isEmpty());
    }

    // -- helpers --

    private Path createTable(Path tempDir, String ddl) throws Exception
    {
        Path dbFile = tempDir.resolve("test.db");
        try (Connection conn = DriverManager.getConnection("jdbc:sqlite:" + dbFile.toString()); Statement stmt = conn.createStatement())
        {
            stmt.execute(ddl);
        }
        return dbFile;
    }

    private JdbcConnection createTempDbConnection(Path tempDir)
    {
        Path dbFile = tempDir.resolve("test.db");
        return new JdbcConnection("test", "Test", dialect, Map.of("filePath", dbFile.toString()));
    }
}
