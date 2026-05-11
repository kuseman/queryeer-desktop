package com.queryeer.backend.queryengine.jdbc.sql;

import com.queryeer.backend.queryengine.jdbc.JdbcDialect;

public interface SqlGrammarResolver
{
    SqlGrammarArtifact resolve(JdbcDialect dialect);
}
