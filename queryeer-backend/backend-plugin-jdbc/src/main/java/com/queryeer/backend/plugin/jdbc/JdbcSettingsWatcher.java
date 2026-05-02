package com.queryeer.backend.plugin.jdbc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.Objects;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;

/**
 * Watches the JDBC settings file for modifications and reloads the connection registry when the file changes. Designed to be called at the top of a periodic background loop — no polling thread of its
 * own.
 */
final class JdbcSettingsWatcher
{
    private final JdbcSettingsConnectionSource source;
    private final ConfigService config;
    private final LoggerService logger;

    private volatile FileTime lastModifiedTime = FileTime.fromMillis(0L);

    JdbcSettingsWatcher(JdbcSettingsConnectionSource source, ConfigService config, LoggerService logger)
    {
        this.source = source;
        this.config = config;
        this.logger = logger;
    }

    /**
     * Checks whether the settings file has been modified since the last read. If changed, reloads all connections and updates the registry. Safe to call from any thread.
     */
    void checkAndReload(JdbcConnectionRegistry registry)
    {
        Path path = JdbcSettingsConnectionSource.resolvePath(config);
        if (path == null
                || !Files.exists(path))
        {
            return;
        }

        FileTime currentMtime;
        try
        {
            currentMtime = Files.getLastModifiedTime(path);
        }
        catch (IOException e)
        {
            logger.warn("Could not stat JDBC settings file: " + path);
            return;
        }

        if (Objects.equals(currentMtime, lastModifiedTime))
        {
            return;
        }

        lastModifiedTime = currentMtime;
        List<JdbcSettingsConnectionSource.JdbcConfiguredConnection> loaded = source.load(config, logger);
        registry.reload(loaded);
        logger.info("Reloaded JDBC connections from disk (" + loaded.size() + " connections)");
    }
}
