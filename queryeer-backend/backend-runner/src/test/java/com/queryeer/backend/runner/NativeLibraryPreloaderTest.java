package com.queryeer.backend.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

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
}
