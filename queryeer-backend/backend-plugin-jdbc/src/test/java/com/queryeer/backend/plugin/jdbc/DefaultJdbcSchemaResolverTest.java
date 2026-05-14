package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

class DefaultJdbcSchemaResolverTest
{
    @Test
    void resolvesTablesAndColumnsFromInformationSchema() throws Exception
    {
        String url = "jdbc:h2:mem:test_schema_resolver;DB_CLOSE_DELAY=-1";
        try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement())
        {
            statement.execute("create table person(id int primary key, name varchar(64))");
            statement.execute("create table orders(order_id int primary key, person_id int, constraint fk_person foreign key(person_id) references person(id))");
            statement.execute("create index idx_orders_person on orders(person_id)");
        }

        DefaultJdbcSchemaResolver resolver = new DefaultJdbcSchemaResolver();
        JdbcConnection conn = new JdbcConnection("coonection", "connection", new BasicJdbcDialect(), Map.of("url", url));

        // Top level returns databases_container
        List<JdbcSchemaObject> roots = resolver.resolveSchema(conn, Map.of());
        Assertions.assertEquals(1, roots.size(), "expected databases_container");
        Assertions.assertEquals("databases_container", roots.get(0)
                .kind());

        // Get database (lazy, no children)
        JdbcSchemaObject db = roots.get(0)
                .children()
                .get(0);
        Assertions.assertEquals("database", db.kind());
        Assertions.assertNull(db.children(), "database should have null children (lazy-loaded)");

        // Expand database → schemas_container with schema children
        List<JdbcSchemaObject> dbChildren = resolver.resolveSchema(conn, Map.of("parentKind", "database"));
        Assertions.assertEquals(1, dbChildren.size());
        JdbcSchemaObject schemasContainer = dbChildren.get(0);
        Assertions.assertEquals("schemas_container", schemasContainer.kind());

        // Get schemas
        JdbcSchemaObject schema = schemasContainer.children()
                .get(0);
        Assertions.assertEquals("schema", schema.kind());

        // Expand schema → folders (Tables, Views, Procedures)
        List<JdbcSchemaObject> folders = resolver.resolveSchema(conn, Map.of("parentKind", "schema"));
        Assertions.assertEquals(3, folders.size());
        Assertions.assertEquals("tables_folder", folders.get(0)
                .kind());

        // Expand tables_folder → table objects (no database filter since H2 catalog varies)
        List<JdbcSchemaObject> tables = resolver.resolveSchema(conn, Map.of("parentKind", "tables_folder", "target", Map.of("schema", "PUBLIC")));

        JdbcSchemaObject person = tables.stream()
                .filter(t -> "person".equalsIgnoreCase(t.name()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(person.children() == null
                || person.children()
                        .isEmpty(),
                "table object should have null/empty children (lazy-loaded)");

        // Expand table → columns + constraints
        // H2 stores unquoted identifiers as uppercase
        List<JdbcSchemaObject> columns = resolver.resolveSchema(conn, Map.of("parentKind", "table", "target", Map.of("schema", "PUBLIC", "table", "PERSON")));
        Assertions.assertTrue(columns.stream()
                .anyMatch(c -> "id".equalsIgnoreCase(c.name())));
        Assertions.assertTrue(columns.stream()
                .anyMatch(c -> "name".equalsIgnoreCase(c.name())));

        List<JdbcSchemaObject> ordersColumns = resolver.resolveSchema(conn, Map.of("parentKind", "table", "target", Map.of("schema", "PUBLIC", "table", "ORDERS")));
        // FK and Index info is now inlined on the column node via attributes
        Assertions.assertTrue(ordersColumns.stream()
                .anyMatch(c -> "person_id".equalsIgnoreCase(c.name())
                        && Boolean.TRUE.equals(c.attributes()
                                .get("foreignKey"))));
    }

    @Test
    void schemaFoldersHaveUniqueIdsAcrossDifferentSchemas() throws Exception
    {
        // Regression: folder IDs must include schema context so expanding two different
        // schemas doesn't overwrite each other's folders in the frontend node map.
        DefaultJdbcSchemaResolver resolver = new DefaultJdbcSchemaResolver();
        JdbcConnection conn = new JdbcConnection("coonection", "connection", new BasicJdbcDialect(), Map.of("url", "jdbc:h2:mem:test_folder_ids;DB_CLOSE_DELAY=-1"));

        // Folders for schema "public"
        List<JdbcSchemaObject> publicFolders = resolver.resolveSchema(conn, Map.of("parentKind", "schema", "target", Map.of("database", "test", "schema", "public")));
        Assertions.assertEquals(3, publicFolders.size());
        String publicTablesId = publicFolders.get(0)
                .id();
        Assertions.assertTrue(publicTablesId.contains("public"), "public's tables_folder id should mention 'public': " + publicTablesId);

        // Folders for schema "pg_catalog"
        List<JdbcSchemaObject> pgFolders = resolver.resolveSchema(conn, Map.of("parentKind", "schema", "target", Map.of("database", "test", "schema", "pg_catalog")));
        String pgTablesId = pgFolders.get(0)
                .id();
        Assertions.assertTrue(pgTablesId.contains("pg_catalog"), "pg_catalog's tables_folder id should mention 'pg_catalog': " + pgTablesId);

        // IDs must be different
        Assertions.assertNotEquals(publicTablesId, pgTablesId, "folder IDs must differ across schemas to prevent node map collisions");
    }
}
