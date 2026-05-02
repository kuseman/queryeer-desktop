package com.queryeer.backend.runner;

import java.io.IOException;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Stream;

/**
 * Scans {@code <appDir>/libShared} for JAR files and collects their URLs. The caller is expected to build the classloader hierarchy so that these shared URLs sit above the classloader that defines
 * plugin classes — this ensures {@link java.sql.DriverManager#isDriverAllowed} can reach drivers found in {@code libShared} through parent-delegation.
 *
 * <p>
 * Drop {@code mssql-jdbc-*.jar} (or any other JDBC driver) into {@code libShared} to make it available to all dialect plugins without bundling it in the distribution.
 * </p>
 */
final class SharedLibraryLoader
{
    static List<URL> collect(String appDir)
    {
        if (appDir == null
                || appDir.isBlank())
        {
            return List.of();
        }
        Path libDir = Path.of(appDir.trim(), "libShared");
        if (!Files.isDirectory(libDir))
        {
            return List.of();
        }
        List<URL> urls = new ArrayList<>();
        try (Stream<Path> stream = Files.list(libDir))
        {
            stream.filter(p -> p.getFileName()
                    .toString()
                    .endsWith(".jar"))
                    .sorted()
                    .forEach(p ->
                    {
                        try
                        {
                            urls.add(p.toUri()
                                    .toURL());
                        }
                        catch (Exception e)
                        {
                            throw new RuntimeException("Cannot convert path to URL: " + p, e);
                        }
                    });
        }
        catch (IOException e)
        {
            return List.of();
        }
        return Collections.unmodifiableList(urls);
    }

    private SharedLibraryLoader()
    {
    }
}
