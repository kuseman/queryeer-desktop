package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class DefaultJdbcDialectRegistryTest
{
    @Test
    void registerStoresDialectById()
    {
        DefaultJdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        JdbcDialect dialect = dialect("postgres", "PostgreSQL");

        registry.register(dialect);

        Assertions.assertEquals(dialect, registry.find("postgres")
                .orElseThrow());
        Assertions.assertEquals(List.of("postgres"), registry.all()
                .stream()
                .map(JdbcDialectMetadata::id)
                .toList());
    }

    @Test
    void registerRejectsDuplicateDialectId()
    {
        DefaultJdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(dialect("mysql", "MySQL"));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> registry.register(dialect("mysql", "MySQL alt")));

        Assertions.assertEquals("dialect already registered: mysql", error.getMessage());
    }

    @Test
    void allReturnsSortedDialectMetadata()
    {
        DefaultJdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(dialect("sqlserver", "SQL Server"));
        registry.register(dialect("postgres", "PostgreSQL"));

        Assertions.assertEquals(List.of("postgres", "sqlserver"), registry.all()
                .stream()
                .map(JdbcDialectMetadata::id)
                .toList());
    }

    @Test
    void registerRejectsMissingDialectId()
    {
        DefaultJdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> registry.register(dialect(" ", "No id")));

        Assertions.assertEquals("dialect id is required", error.getMessage());
    }

    private static JdbcDialect dialect(String id, String name)
    {
        return new JdbcDialect()
        {
            @Override
            public JdbcDialectMetadata metadata()
            {
                return new JdbcDialectMetadata(id, name, 5432, "jdbc:demo://${host}:${port}/${database}");
            }

            @Override
            public JdbcConnectionSetupDefinition connectionSetup()
            {
                return new JdbcConnectionSetupDefinition(List.of(new JdbcConnectionFieldDefinition("host", "Host", JdbcConnectionFieldType.TEXT, true, null, List.of(), "localhost")));
            }

            @Override
            public JdbcQueryExecutor queryExecutor()
            {
                return (request, eventListener) -> new JdbcQueryResult(0, Map.of());
            }

            @Override
            public JdbcSchemaResolver schemaResolver()
            {
                return connection -> List.of();
            }
        };
    }
}
