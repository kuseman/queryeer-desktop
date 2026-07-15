package com.queryeer.backend.queryengine.jdbc;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Optional;

public final class FileFormatDetector
{
    private static final byte[] SQLITE_HEADER = "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII);

    private FileFormatDetector()
    {
    }

    /**
     * Tries to detect the database format of the given file. Uses magic bytes first, then falls back to JDBC driver probing.
     *
     * @return detected format if successful, empty if unknown
     */
    public static Optional<DetectedFormat> detect(Path filePath)
    {
        if (!Files.isRegularFile(filePath))
        {
            return Optional.empty();
        }

        // Magic bytes detection
        Optional<DetectedFormat> magicResult = detectByMagicBytes(filePath);
        if (magicResult.isPresent())
        {
            return magicResult;
        }

        // JDBC probe fallback — try SQLite first
        return probeSqlite(filePath);
    }

    private static Optional<DetectedFormat> detectByMagicBytes(Path filePath)
    {
        try (RandomAccessFile raf = new RandomAccessFile(filePath.toFile(), "r"))
        {
            if (raf.length() < SQLITE_HEADER.length)
            {
                return Optional.empty();
            }
            byte[] header = new byte[SQLITE_HEADER.length];
            raf.readFully(header);
            if (matches(header, SQLITE_HEADER))
            {
                return Optional.of(new DetectedFormat("sqlite", "SQLite"));
            }
            return Optional.empty();
        }
        catch (IOException e)
        {
            return Optional.empty();
        }
    }

    private static Optional<DetectedFormat> probeSqlite(Path filePath)
    {
        String url = "jdbc:sqlite:" + filePath.toString();
        try
        {
            DriverManager.getConnection(url)
                    .close();
            return Optional.of(new DetectedFormat("sqlite", "SQLite"));
        }
        catch (SQLException e)
        {
            // Driver not available or connection failed
            return Optional.empty();
        }
    }

    private static boolean matches(byte[] actual, byte[] expected)
    {
        if (actual.length < expected.length)
        {
            return false;
        }
        for (int i = 0; i < expected.length; i++)
        {
            if (actual[i] != expected[i])
            {
                return false;
            }
        }
        return true;
    }

    public record DetectedFormat(String dialectId, String displayName)
    {
    }
}
