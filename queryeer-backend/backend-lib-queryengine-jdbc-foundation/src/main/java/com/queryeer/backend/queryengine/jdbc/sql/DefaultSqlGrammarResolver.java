package com.queryeer.backend.queryengine.jdbc.sql;

import com.queryeer.backend.queryengine.jdbc.JdbcDialect;

public final class DefaultSqlGrammarResolver implements SqlGrammarResolver
{
    private final SqlGrammarArtifactLocator locator;

    public DefaultSqlGrammarResolver(SqlGrammarArtifactLocator locator)
    {
        this.locator = locator;
    }

    @Override
    public SqlGrammarArtifact resolve(JdbcDialect dialect)
    {
        if (dialect == null)
        {
            throw new IllegalArgumentException("dialect is required");
        }
        return locator.locate(dialect.sqlGrammarId());
    }
}
