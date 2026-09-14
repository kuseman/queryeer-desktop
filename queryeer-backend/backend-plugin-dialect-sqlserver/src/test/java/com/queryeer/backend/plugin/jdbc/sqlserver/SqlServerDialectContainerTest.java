package com.queryeer.backend.plugin.jdbc.sqlserver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MSSQLServerContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

@Testcontainers(
        disabledWithoutDocker = true)
class SqlServerDialectContainerTest
{
    private static final String DATABASE = "master";
    private static final String SCHEMA = "queryeer_test";

    @Container
    private static final MSSQLServerContainer<?> SQL_SERVER = new MSSQLServerContainer<>("mcr.microsoft.com/mssql/server:2022-CU20-ubuntu-22.04").acceptLicense();

    private static final SqlServerDialect DIALECT = new SqlServerDialect();

    @BeforeAll
    static void createSchema() throws Exception
    {
        try (Connection connection = DriverManager.getConnection(SQL_SERVER.getJdbcUrl(), SQL_SERVER.getUsername(), SQL_SERVER.getPassword()); Statement statement = connection.createStatement())
        {
            statement.execute("create schema " + SCHEMA);
            statement.execute("create table " + SCHEMA + ".queryeer_parent (id int not null primary key, name nvarchar(50))");
            statement.execute("create table " + SCHEMA
                              + ".queryeer_child (id int not null primary key, parent_id int null constraint fk_queryeer_child_parent references "
                              + SCHEMA
                              + ".queryeer_parent(id), value nvarchar(50))");
            statement.execute("create unique index ix_queryeer_child_value on " + SCHEMA + ".queryeer_child(value desc)");
            statement.execute("create view " + SCHEMA + ".queryeer_view as select id, parent_id, value from " + SCHEMA + ".queryeer_child");
            statement.execute("create procedure " + SCHEMA + ".queryeer_procedure @input int, @output nvarchar(20) output as select @output = convert(nvarchar(20), @input)");
            statement.execute("create trigger " + SCHEMA + ".queryeer_trigger on " + SCHEMA + ".queryeer_child after insert as begin set nocount on; end");
        }
    }

    @Test
    void resolvesDatabasesAndSchemas()
    {
        List<JdbcSchemaObject> databaseContainers = resolve("databases_container", null);
        JdbcSchemaObject databases = object(databaseContainers, "Databases");
        assertEquals("databases_container", databases.kind());
        assertEquals("database", object(databases.children(), DATABASE).kind());

        List<JdbcSchemaObject> schemas = resolve("schemas_container", new JdbcSchemaTarget(DATABASE, null));
        JdbcSchemaObject schema = object(schemas, SCHEMA);
        assertEquals("schema", schema.kind());
        assertEquals(DATABASE, schema.attributes()
                .get("catalog"));

        JdbcSchemaObject schemaContainer = object(resolve("database", new JdbcSchemaTarget(DATABASE, null)), "Schemas");
        assertEquals("schemas_container", schemaContainer.kind());
        object(schemaContainer.children(), SCHEMA);
    }

    @Test
    void resolvesTablesViewsTriggersAndTableFolders()
    {
        JdbcSchemaTarget schemaTarget = new JdbcSchemaTarget(DATABASE, SCHEMA);
        JdbcSchemaObject table = object(resolve("tables_folder", schemaTarget), "queryeer_child");
        assertEquals("table", table.kind());
        assertEquals(SCHEMA + ".queryeer_child", table.fullName());
        JdbcSchemaObject view = object(resolve("views_folder", schemaTarget), "queryeer_view");
        assertEquals("view", view.kind());
        JdbcSchemaObject trigger = object(resolve("triggers_folder", schemaTarget), "queryeer_trigger");
        assertEquals("trigger", trigger.kind());

        List<JdbcSchemaObject> folders = resolve("table", new JdbcSchemaTarget(DATABASE, SCHEMA, "queryeer_child"));
        assertEquals("columns_folder", object(folders, "Columns").kind());
        assertEquals("indexes_folder", object(folders, "Indexes").kind());
    }

    @Test
    void resolvesProceduresAndParameters()
    {
        JdbcSchemaObject procedure = object(resolve("procedures_folder", new JdbcSchemaTarget(DATABASE, SCHEMA)), "queryeer_procedure");
        assertEquals("procedure", procedure.kind());
        assertEquals(SCHEMA + ".queryeer_procedure", procedure.fullName());

        JdbcSchemaObject input = object(procedure.children(), "@input");
        assertEquals("int", input.attributes()
                .get("type"));
        assertEquals("IN", input.attributes()
                .get("mode"));
        JdbcSchemaObject output = object(procedure.children(), "@output");
        assertEquals("OUT", output.attributes()
                .get("mode"));
    }

    @Test
    void resolvesPrimaryAndForeignKeyColumnMetadata()
    {
        List<JdbcSchemaObject> columns = resolve("columns_folder", new JdbcSchemaTarget(DATABASE, SCHEMA, "queryeer_child"));

        JdbcSchemaObject id = object(columns, "id");
        assertEquals(true, id.attributes()
                .get("primaryKey"));
        assertFalse(id.attributes()
                .containsKey("foreignKey"));

        JdbcSchemaObject parentId = object(columns, "parent_id");
        assertEquals(true, parentId.attributes()
                .get("foreignKey"));
        assertEquals(SCHEMA, parentId.attributes()
                .get("referencesSchema"));
        assertEquals("queryeer_parent", parentId.attributes()
                .get("referencesTable"));
        assertEquals("id", parentId.attributes()
                .get("referencesColumn"));
        assertNull(parentId.attributes()
                .get("primaryKey"));
    }

    @Test
    void resolvesIndexes()
    {
        List<JdbcSchemaObject> indexes = resolve("indexes_folder", new JdbcSchemaTarget(DATABASE, SCHEMA, "queryeer_child"));

        JdbcSchemaObject primaryKey = indexes.stream()
                .filter(index -> Boolean.TRUE.equals(index.attributes()
                        .get("primaryKey")))
                .findFirst()
                .orElseThrow();
        assertEquals("id", primaryKey.attributes()
                .get("columns"));
        assertEquals("id", primaryKey.children()
                .get(0)
                .name());

        JdbcSchemaObject valueIndex = object(indexes, "ix_queryeer_child_value");
        assertEquals(true, valueIndex.attributes()
                .get("unique"));
        assertEquals("value", valueIndex.attributes()
                .get("columns"));
        assertEquals("DESC", valueIndex.children()
                .get(0)
                .attributes()
                .get("sortOrder"));
    }

    @Test
    void resolvesUsers()
    {
        List<JdbcSchemaObject> users = resolve("users_folder", null);

        assertTrue(users.stream()
                .anyMatch(user -> SQL_SERVER.getUsername()
                        .equalsIgnoreCase(user.name())));
    }

    @Test
    void resolvesDeepSchemaInBulk()
    {
        JdbcConnection connection = connection();
        List<JdbcSchemaObject> objects = DIALECT.deepSchemaResolver()
                .orElseThrow()
                .resolveDeepSchema(connection, new JdbcSchemaTarget(DATABASE, SCHEMA));

        JdbcSchemaObject child = object(objects, "queryeer_child");
        assertEquals("table", child.kind());
        JdbcSchemaObject columns = object(child.children(), "Columns");
        assertEquals(true, object(columns.children(), "id").attributes()
                .get("primaryKey"));
        assertEquals("queryeer_parent", object(columns.children(), "parent_id").attributes()
                .get("referencesTable"));
        JdbcSchemaObject indexes = object(child.children(), "Indexes");
        assertEquals("DESC", object(indexes.children(), "ix_queryeer_child_value").children()
                .get(0)
                .attributes()
                .get("sortOrder"));

        JdbcSchemaObject view = object(objects, "queryeer_view");
        assertEquals("view", view.kind());
        object(object(view.children(), "Columns").children(), "parent_id");

        JdbcSchemaObject procedure = object(objects, "queryeer_procedure");
        assertEquals("OUT", object(procedure.children(), "@output").attributes()
                .get("mode"));
        assertTrue(objects.stream()
                .allMatch(object -> SCHEMA.equals(object.attributes()
                        .get("schema"))));
    }

    private static List<JdbcSchemaObject> resolve(String kind, JdbcSchemaTarget target)
    {
        JdbcConnection connection = connection();
        Map<String, Object> options = target == null ? Map.of()
                : Map.of("target", target);
        return DIALECT.branchResolvers()
                .get(kind)
                .resolveSchema(connection, options);
    }

    private static JdbcConnection connection()
    {
        Map<String, Object> properties = Map.of("host", SQL_SERVER.getHost(), "port", SQL_SERVER.getMappedPort(MSSQLServerContainer.MS_SQL_SERVER_PORT), "database", DATABASE, "username",
                SQL_SERVER.getUsername(), "password", SQL_SERVER.getPassword(), "trustServerCertificate", true);
        return new JdbcConnection("sqlserver-test", "SQL Server Test", DIALECT, properties);
    }

    private static JdbcSchemaObject object(List<JdbcSchemaObject> objects, String name)
    {
        return objects.stream()
                .filter(object -> name.equalsIgnoreCase(object.name()))
                .findFirst()
                .orElseThrow();
    }
}
