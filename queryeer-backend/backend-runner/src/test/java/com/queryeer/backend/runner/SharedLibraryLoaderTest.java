package com.queryeer.backend.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SharedLibraryLoaderTest
{
    private static final String SQL_SERVER_DRIVER = "com/microsoft/sqlserver/jdbc/SQLServerDriver.class";
    private static final String POSTGRES_DRIVER = "org/postgresql/Driver.class";

    @TempDir
    Path tempDir;

    @Test
    void includesOnlyTheManagedJarForAKnownProvider() throws Exception
    {
        Path libShared = Files.createDirectories(tempDir.resolve("libShared"));
        Path manual = createJar(libShared.resolve("mssql-jdbc-14.0.0.jre11.jar"), "14.0.0.jre11", SQL_SERVER_DRIVER);
        Path managed = createJar(libShared.resolve("000-queryeer-managed-mssql-jdbc-13.4.0.jre11.jar"), "13.4.0.jre11", SQL_SERVER_DRIVER);
        Path unrelated = createJar(libShared.resolve("unrelated.jar"), "1.0", "example/Unrelated.class");

        List<URL> result = SharedLibraryLoader.collect(tempDir.toString());

        assertEquals(List.of(managed.toUri()
                .toURL(),
                unrelated.toUri()
                        .toURL()),
                result);
        org.junit.jupiter.api.Assertions.assertFalse(result.contains(manual.toUri()
                .toURL()));
    }

    @Test
    void selectsTheNewestIdentifiableManualProviderJar() throws Exception
    {
        Path libShared = Files.createDirectories(tempDir.resolve("libShared"));
        createJar(libShared.resolve("mssql-jdbc-9.4.0.jre11.jar"), "9.4.0.jre11", SQL_SERVER_DRIVER);
        Path newest = createJar(libShared.resolve("mssql-jdbc-13.4.0.jre11.jar"), "13.4.0.jre11", SQL_SERVER_DRIVER);

        assertEquals(List.of(newest.toUri()
                .toURL()), SharedLibraryLoader.collect(tempDir.toString()));
    }

    @Test
    void excludesAmbiguousAndMultiProviderJars() throws Exception
    {
        Path libShared = Files.createDirectories(tempDir.resolve("libShared"));
        createJar(libShared.resolve("sqlserver-a.jar"), null, SQL_SERVER_DRIVER);
        createJar(libShared.resolve("sqlserver-b.jar"), null, SQL_SERVER_DRIVER);
        createJar(libShared.resolve("multi-provider.jar"), "1.0", SQL_SERVER_DRIVER, POSTGRES_DRIVER);

        assertEquals(List.of(), SharedLibraryLoader.collect(tempDir.toString()));
    }

    @Test
    void acceptsAnUppercaseJarExtension() throws Exception
    {
        Path libShared = Files.createDirectories(tempDir.resolve("libShared"));
        Path driver = createJar(libShared.resolve("mssql-jdbc-13.4.0.JAR"), "13.4.0.jre11", SQL_SERVER_DRIVER);

        assertEquals(List.of(driver.toUri()
                .toURL()), SharedLibraryLoader.collect(tempDir.toString()));
    }

    private Path createJar(Path path, String version, String... entries) throws Exception
    {
        Manifest manifest = new Manifest();
        manifest.getMainAttributes()
                .put(Attributes.Name.MANIFEST_VERSION, "1.0");
        if (version != null)
        {
            manifest.getMainAttributes()
                    .putValue("Implementation-Version", version);
        }
        try (JarOutputStream output = new JarOutputStream(Files.newOutputStream(path), manifest))
        {
            for (String entry : entries)
            {
                output.putNextEntry(new JarEntry(entry));
                output.write(new byte[] { 0 });
                output.closeEntry();
            }
        }
        return path;
    }
}
