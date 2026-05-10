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

class InformationSchemaJdbcSchemaResolverTest
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

        InformationSchemaJdbcSchemaResolver resolver = new InformationSchemaJdbcSchemaResolver();
        JdbcConnection connection = new JdbcConnection("coonection", "connection", new BasicJdbcDialect(), Map.of("url", url));

        List<JdbcSchemaObject> roots = resolver.resolveSchema(connection, Map.of());

        JdbcSchemaObject table = roots.stream()
                .flatMap(database -> database.children()
                        .stream())
                .flatMap(schema -> schema.children()
                        .stream())
                .filter(object -> "person".equalsIgnoreCase(object.name()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(table.children()
                .stream()
                .anyMatch(column -> "id".equalsIgnoreCase(column.name())));
        Assertions.assertTrue(table.children()
                .stream()
                .anyMatch(column -> "name".equalsIgnoreCase(column.name())));

        JdbcSchemaObject orders = roots.stream()
                .flatMap(database -> database.children()
                        .stream())
                .flatMap(schema -> schema.children()
                        .stream())
                .filter(object -> "orders".equalsIgnoreCase(object.name()))
                .findFirst()
                .orElseThrow();
        Assertions.assertTrue(orders.children()
                .stream()
                .anyMatch(child -> "foreign_key".equals(child.kind())));
        Assertions.assertTrue(orders.children()
                .stream()
                .anyMatch(child -> "index".equals(child.kind())));
    }
}
