package com.queryeer.backend.queryengine.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryResult;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;

class JdbcDialectSqlGrammarTest
{
    @Test
    void defaultGrammarIsPostgres()
    {
        JdbcDialect dialect = new TestDialect("demo", "Demo");
        assertEquals("postgres", dialect.sqlGrammarId());
    }

    private static final class TestDialect implements JdbcDialect
    {
        private final String id;
        private final String name;

        private TestDialect(String id, String name)
        {
            this.id = id;
            this.name = name;
        }

        @Override
        public JdbcDialectMetadata metadata()
        {
            return new JdbcDialectMetadata(id, name, null, "jdbc:demo", null);
        }

        @Override
        public JdbcQueryExecutor queryExecutor()
        {
            return (_, _) -> new JdbcQueryResult(0, Map.of());
        }

        @Override
        public JdbcSchemaResolver schemaResolver()
        {
            return (_, _) -> List.of();
        }

        @Override
        public String buildUrl(Map<String, Object> materializedProperties)
        {
            return "jdbc:demo";
        }
    }
}
