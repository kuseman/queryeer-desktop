package com.queryeer.backend.queryengine.jdbc.sql;

import java.nio.file.Path;

public record SqlGrammarArtifact(String grammarId, SqlRuntimePlatform platform, Path location, boolean classpathResource)
{
}
