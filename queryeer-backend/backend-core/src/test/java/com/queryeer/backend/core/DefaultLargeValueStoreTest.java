package com.queryeer.backend.core;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LargeValueWriter;
import com.queryeer.backend.contract.query.QueryLargeValueCell;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;

class DefaultLargeValueStoreTest
{
    @TempDir
    Path tempDir;

    @Test
    void constructorDeletesStaleSpillFilesFromPreviousProcess() throws Exception
    {
        Files.writeString(tempDir.resolve("large-value-stale.txt"), "stale");
        Files.createDirectories(tempDir.resolve("nested"));
        Files.writeString(tempDir.resolve("nested")
                .resolve("large-value-stale.txt"), "stale");

        new DefaultLargeValueStore(tempDir, 4, 5);

        try (Stream<Path> files = Files.list(tempDir))
        {
            Assertions.assertEquals(0L, files.count());
        }
    }

    @Test
    void storeTextReturnsInlineStringBelowThreshold()
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 16, 8);

        Object cell = store.storeText("exec-1", "text", "text/plain", "hello");

        Assertions.assertEquals("hello", cell);
    }

    @Test
    void createSpillsTextAboveDefaultInlineThreshold() throws Exception
    {
        DefaultLargeValueStore store = DefaultLargeValueStore.create(configWithAppDir(tempDir));
        store.registerExecution("exec-1", "file-1");

        Object cell = store.storeText("exec-1", "text", "text/plain", "a".repeat(20 * 1024));

        Assertions.assertTrue(cell instanceof QueryLargeValueCell);
        QueryLargeValueCell large = (QueryLargeValueCell) cell;
        Assertions.assertEquals(20 * 1024, store.read(large.ref())
                .content()
                .length());
    }

    @Test
    void storeTextSpillsAboveThresholdAndCanReadFullContent() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        store.registerExecution("exec-1", "file-1");

        Object cell = store.storeText("exec-1", "json", "application/json", "{\"abcdef\":true}");

        Assertions.assertTrue(cell instanceof QueryLargeValueCell);
        QueryLargeValueCell large = (QueryLargeValueCell) cell;
        Assertions.assertEquals("largeValue", large.kind());
        Assertions.assertEquals("json", large.logicalType());
        Assertions.assertEquals("{\"abc", large.preview());
        Assertions.assertTrue(large.byteLength() > 4);

        QueryLargeValueReadResult result = store.read(large.ref());
        Assertions.assertEquals("{\"abcdef\":true}", result.content());
        Assertions.assertEquals("application/json", result.contentType());
    }

    @Test
    void cleanupFileDeletesSpilledValuesForThatFile() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        store.registerExecution("exec-1", "file-1");

        QueryLargeValueCell large = (QueryLargeValueCell) store.storeText("exec-1", "text", "text/plain", "abcdefgh");
        Assertions.assertNotNull(store.read(large.ref()));

        store.cleanupFile("file-1");

        Assertions.assertNull(store.read(large.ref()));
        try (Stream<Path> files = Files.list(tempDir))
        {
            Assertions.assertEquals(0L, files.count());
        }
    }

    @Test
    void cleanupFileBeforeNextExecutionDeletesPreviousValuesAndAllowsNewValues() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        store.registerExecution("exec-1", "file-1");
        QueryLargeValueCell oldLarge = (QueryLargeValueCell) store.storeText("exec-1", "text", "text/plain", "abcdefgh");

        store.cleanupFile("file-1");
        store.registerExecution("exec-2", "file-1");
        QueryLargeValueCell newLarge = (QueryLargeValueCell) store.storeText("exec-2", "text", "text/plain", "ijklmnop");

        Assertions.assertNull(store.read(oldLarge.ref()));
        Assertions.assertEquals("ijklmnop", store.read(newLarge.ref())
                .content());
        try (Stream<Path> files = Files.list(tempDir))
        {
            Assertions.assertEquals(1L, files.count());
        }
    }

    @Test
    void lateWriterCloseAfterFileCleanupDeletesSpillAndReturnsPreview() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        store.registerExecution("exec-1", "file-1");
        LargeValueWriter writer = store.create("exec-1", "text", "text/plain");
        writer.writer()
                .write("abcdefgh");

        store.cleanupFile("file-1");
        Object cell = writer.closeToCell();

        Assertions.assertEquals("abcde", cell);
        try (Stream<Path> files = Files.list(tempDir))
        {
            Assertions.assertEquals(0L, files.count());
        }
    }

    private static ConfigService configWithAppDir(Path appDir)
    {
        return key -> "queryeer.app.dir".equals(key) ? appDir.toString()
                : null;
    }
}
