package com.queryeer.backend.queryengine.jdbc.sql;

import java.nio.file.Files;
import java.nio.file.Path;

public final class DistSqlGrammarArtifactLocator implements SqlGrammarArtifactLocator
{
    public static final String DEFAULT_DIST_DIR = "dist/tree-sitter";
    public static final String ARTIFACT_FILE = "grammar.bundle";
    public static final String DIST_ROOT_OVERRIDE_PROPERTY = "queryeer.jdbc.sql.grammar.distDir";
    public static final String DEV_MODE_PROPERTY = "queryeer.devMode";

    private final Path distRoot;
    private final SqlRuntimePlatform platform;
    private final boolean devMode;

    public DistSqlGrammarArtifactLocator()
    {
        this(resolveDistRoot(), SqlRuntimePlatform.detect(), isDevMode());
    }

    DistSqlGrammarArtifactLocator(Path distRoot, SqlRuntimePlatform platform, boolean devMode)
    {
        this.distRoot = distRoot;
        this.platform = platform;
        this.devMode = devMode;
    }

    @Override
    public SqlGrammarArtifact locate(String grammarId)
    {
        if (grammarId == null
                || grammarId.isBlank())
        {
            throw new IllegalArgumentException("grammarId is required");
        }
        Path location = distRoot.resolve(platform.classifier())
                .resolve(grammarId)
                .resolve(ARTIFACT_FILE)
                .normalize();

        if (devMode
                && !Files.exists(location))
        {
            throw new IllegalArgumentException("Missing SQL grammar artifact for " + grammarId + " at " + location);
        }

        return new SqlGrammarArtifact(grammarId, platform, location, !devMode);
    }

    private static Path resolveDistRoot()
    {
        String override = System.getProperty(DIST_ROOT_OVERRIDE_PROPERTY);
        if (override != null
                && !override.isBlank())
        {
            return Path.of(override.trim());
        }
        return Path.of(DEFAULT_DIST_DIR);
    }

    private static boolean isDevMode()
    {
        return Boolean.parseBoolean(System.getProperty(DEV_MODE_PROPERTY, "false"));
    }
}
