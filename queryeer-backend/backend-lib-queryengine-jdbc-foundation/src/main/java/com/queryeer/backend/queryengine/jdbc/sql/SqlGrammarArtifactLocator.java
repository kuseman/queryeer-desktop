package com.queryeer.backend.queryengine.jdbc.sql;

public interface SqlGrammarArtifactLocator
{
    SqlGrammarArtifact locate(String grammarId);
}
