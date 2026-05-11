package com.queryeer.backend.queryengine.jdbc.sql;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DistSqlGrammarArtifactLocatorTest
{
    @TempDir
    Path tempDir;

    @Test
    void devModeRequiresExistingArtifact() throws IOException
    {
        Path artifact = tempDir.resolve("windows-x64/postgres/grammar.bundle");
        Files.createDirectories(artifact.getParent());
        Files.writeString(artifact, "placeholder");

        DistSqlGrammarArtifactLocator locator = new DistSqlGrammarArtifactLocator(tempDir, SqlRuntimePlatform.from("Windows", "x86_64"), true);
        SqlGrammarArtifact resolved = locator.locate("postgres");

        assertEquals(artifact.normalize(), resolved.location());
        assertFalse(resolved.classpathResource());
    }

    @Test
    void devModeThrowsOnMissingArtifact()
    {
        DistSqlGrammarArtifactLocator locator = new DistSqlGrammarArtifactLocator(tempDir, SqlRuntimePlatform.from("Windows", "x86_64"), true);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> locator.locate("postgres"));
        assertTrue(error.getMessage()
                .contains("Missing SQL grammar artifact"));
    }

    @Test
    void releaseModeReturnsPathWithoutExistenceCheck()
    {
        DistSqlGrammarArtifactLocator locator = new DistSqlGrammarArtifactLocator(tempDir, SqlRuntimePlatform.from("Linux", "amd64"), false);
        SqlGrammarArtifact resolved = locator.locate("postgres");
        assertTrue(resolved.classpathResource());
        assertEquals(tempDir.resolve("linux-x64/postgres/grammar.bundle")
                .normalize(), resolved.location());
    }
}
