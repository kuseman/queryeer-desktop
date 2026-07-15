package com.queryeer.backend.plugin.jdbc.sqlite;

import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

class SqliteDialectContributorTest
{
    @Test
    void contributeRegistersSqliteDialect()
    {
        JdbcDialectRegistry registry = mock(JdbcDialectRegistry.class);
        SqliteDialectContributor contributor = new SqliteDialectContributor();

        contributor.contribute(registry);

        verify(registry).register(argThat(dialect -> "sqlite".equals(dialect.metadata()
                .id())));
    }
}
