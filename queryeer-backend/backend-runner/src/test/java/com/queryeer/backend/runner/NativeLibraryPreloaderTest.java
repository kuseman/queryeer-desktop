package com.queryeer.backend.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.LoggerService;

class NativeLibraryPreloaderTest
{
    @TempDir
    Path tempDir;

    @Test
    void selectsOnlyTheQueryeerManagedNativeLibrary() throws Exception
    {
        Path nativeDir = Files.createDirectories(tempDir.resolve("libNative"));
        Files.writeString(nativeDir.resolve("mssql-jdbc_auth-12.0.x64.dll"), "manual");
        Path managed = Files.writeString(nativeDir.resolve("mssql-jdbc_auth-13.4.0.x64.queryeer-managed.dll"), "managed");
        PluginManifest.NativeLibrary library = new PluginManifest.NativeLibrary("windows", "x64", List.of("libNative"), List.of("mssql-jdbc_auth*.dll"), false, "example.Loader");
        List<Path> matches = new NativeLibraryPreloader().findMatches(tempDir, library);

        assertEquals(List.of(managed), matches);
    }

    @Test
    void rejectsAmbiguousManualNativeLibraries() throws Exception
    {
        Path nativeDir = Files.createDirectories(tempDir.resolve("libNative"));
        Files.writeString(nativeDir.resolve("mssql-jdbc_auth-12.0.x64.dll"), "manual-12");
        Files.writeString(nativeDir.resolve("mssql-jdbc_auth-13.0.x64.dll"), "manual-13");
        PluginManifest.NativeLibrary library = new PluginManifest.NativeLibrary("windows", "x64", List.of("libNative"), List.of("mssql-jdbc_auth*.dll"), false, "example.Loader");

        assertEquals(List.of(), new NativeLibraryPreloader().findMatches(tempDir, library));
    }

    @Test
    void onlyABuiltinPluginsRequiredLibraryStopsStartup()
    {
        // os and arch "any": runs on every platform
        PluginManifest.NativeLibrary missing = new PluginManifest.NativeLibrary("any", "any", List.of("libNative"), List.of("missing*.dll"), true, null);
        List<String> warnings = new ArrayList<>();
        NativeLibraryPreloader preloader = new NativeLibraryPreloader();
        ClassLoader classLoader = getClass().getClassLoader();

        assertThrows(PluginDiscoveryException.class, () -> preloader.preload(tempDir, List.of(new NativeLibraryPreloader.Request("builtin", missing, true)), classLoader, logger(warnings)));
        preloader.preload(tempDir, List.of(new NativeLibraryPreloader.Request("installed", missing, false)), classLoader, logger(warnings));

        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0)
                .contains("installed"));
    }

    @Test
    void anInstalledPluginsLoaderClassThatCantLoadIsAWarning() throws Exception
    {
        Path nativeDir = Files.createDirectories(tempDir.resolve("libNative"));
        Files.writeString(nativeDir.resolve("example_auth.dll"), "not a library");
        PluginManifest.NativeLibrary library = new PluginManifest.NativeLibrary("any", "any", List.of("libNative"), List.of("example_auth*.dll"), true, "com.example.NoSuchLoader");
        List<String> warnings = new ArrayList<>();

        new NativeLibraryPreloader().preload(tempDir, List.of(new NativeLibraryPreloader.Request("installed", library, false)), getClass().getClassLoader(), logger(warnings));

        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0)
                .contains("Native library preload failed for installed"));
    }

    private static LoggerService logger(List<String> warnings)
    {
        return new LoggerService()
        {
            @Override
            public void info(String message)
            {
            }

            @Override
            public void warn(String message)
            {
                warnings.add(message);
            }

            @Override
            public void error(String message, Throwable error)
            {
            }
        };
    }
}
