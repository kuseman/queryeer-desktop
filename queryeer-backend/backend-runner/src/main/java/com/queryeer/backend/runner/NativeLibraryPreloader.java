package com.queryeer.backend.runner;

import java.lang.reflect.InvocationTargetException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import com.queryeer.backend.api.LoggerService;

final class NativeLibraryPreloader
{
    void preload(Path appDir, List<Request> requests, ClassLoader nativeLibraryClassLoader, LoggerService logger)
    {
        for (Request request : requests)
        {
            preload(appDir, request, nativeLibraryClassLoader, logger);
        }
    }

    private void preload(Path appDir, Request request, ClassLoader nativeLibraryClassLoader, LoggerService logger)
    {
        PluginManifest.NativeLibrary library = request.library();
        if (!matchesCurrentRuntime(library))
        {
            return;
        }

        List<Path> matches = findMatches(appDir, library);
        if (matches.isEmpty())
        {
            String message = "Native library preload skipped for " + request.pluginId() + " (no matching files: " + library.filePatterns() + ")";
            if (library.required())
            {
                throw new PluginDiscoveryException(message);
            }
            logger.warn(message);
            return;
        }

        for (Path match : matches)
        {
            try
            {
                loadWithSharedClassLoader(match, library, nativeLibraryClassLoader);
                logger.info("Preloaded native library for " + request.pluginId() + ": " + match.toAbsolutePath());
                return;
            }
            catch (UnsatisfiedLinkError e)
            {
                logger.warn("Native library preload failed for " + request.pluginId() + " at " + match.toAbsolutePath() + ": " + e.getMessage());
            }
        }

        if (library.required())
        {
            throw new PluginDiscoveryException("Required native library preload failed for " + request.pluginId() + ": " + library.filePatterns());
        }
    }

    private void loadWithSharedClassLoader(Path path, PluginManifest.NativeLibrary library, ClassLoader nativeLibraryClassLoader)
    {
        try
        {
            Class<?> loaderClass = Class.forName(library.loaderClass(), true, nativeLibraryClassLoader);
            loaderClass.getMethod("load", String.class)
                    .invoke(null, path.toAbsolutePath()
                            .toString());
        }
        catch (ReflectiveOperationException e)
        {
            if (e instanceof InvocationTargetException invocationTargetException
                    && invocationTargetException.getCause() instanceof UnsatisfiedLinkError unsatisfiedLinkError)
            {
                throw unsatisfiedLinkError;
            }
            throw new PluginDiscoveryException("Failed to preload native library through shared classloader: " + path.toAbsolutePath(), e);
        }
    }

    List<Path> findMatches(Path appDir, PluginManifest.NativeLibrary library)
    {
        List<Path> matches = new ArrayList<>();
        List<String> searchPaths = library.searchPaths() == null
                || library.searchPaths()
                        .isEmpty() ? List.of("libNative")
                                : library.searchPaths();
        for (String searchPath : searchPaths)
        {
            Path directory = appDir.resolve(searchPath)
                    .normalize();
            if (!directory.startsWith(appDir.normalize())
                    || !Files.isDirectory(directory))
            {
                continue;
            }
            for (String pattern : library.filePatterns())
            {
                try (DirectoryStream<Path> stream = Files.newDirectoryStream(directory, pattern))
                {
                    for (Path path : stream)
                    {
                        if (Files.isRegularFile(path))
                        {
                            matches.add(path);
                        }
                    }
                }
                catch (Exception ignored)
                {
                }
            }
        }
        matches.sort(Comparator.comparing((Path path) -> !isQueryeerManaged(path))
                .thenComparing(path -> path.getFileName()
                        .toString(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(Path::toString));
        List<Path> managed = matches.stream()
                .filter(this::isQueryeerManaged)
                .toList();
        if (!managed.isEmpty())
        {
            return managed.size() == 1 ? managed
                    : List.of();
        }
        return matches.size() <= 1 ? matches
                : List.of();
    }

    private boolean isQueryeerManaged(Path path)
    {
        return path.getFileName()
                .toString()
                .toLowerCase(Locale.ROOT)
                .contains(".queryeer-managed.");
    }

    private boolean matchesCurrentRuntime(PluginManifest.NativeLibrary library)
    {
        return matches(library.os(), osName())
                && matches(library.arch(), archName());
    }

    private boolean matches(String expected, String actual)
    {
        return expected == null
                || expected.isBlank()
                || "any".equalsIgnoreCase(expected)
                || expected.equalsIgnoreCase(actual);
    }

    private String osName()
    {
        String os = System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT);
        if (os.contains("win"))
        {
            return "windows";
        }
        if (os.contains("mac"))
        {
            return "macos";
        }
        return "linux";
    }

    private String archName()
    {
        String arch = System.getProperty("os.arch", "")
                .toLowerCase(Locale.ROOT);
        if (arch.contains("aarch64")
                || arch.contains("arm64"))
        {
            return "arm64";
        }
        return "x64";
    }

    record Request(String pluginId, PluginManifest.NativeLibrary library)
    {
    }
}
