package com.queryeer.backend.runner;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.annotation.JsonCreator;

record PluginManifest(int schemaVersion, String id, String name, String version, BackendTarget backend, FrontendTarget frontend, List<Dependency> dependencies, List<String> providesCapabilities,
        List<String> requiredCapabilities, String description, Packaging packaging, RuntimeTarget runtime)
{

    /** The dependency ids. */
    List<String> dependenciesOrEmpty()
    {
        return dependencies == null ? List.of()
                : dependencies.stream()
                        .map(Dependency::id)
                        .toList();
    }

    /** The version ranges of the dependencies that declare one, keyed by dependency id. */
    Map<String, String> dependencyVersions()
    {
        Map<String, String> versions = new LinkedHashMap<>();
        if (dependencies != null)
        {
            for (Dependency dependency : dependencies)
            {
                if (dependency.version() != null)
                {
                    versions.put(dependency.id(), dependency.version());
                }
            }
        }
        return versions;
    }

    /** The same manifest with another version; built-in plugins carry the backend's version. */
    PluginManifest withVersion(String newVersion)
    {
        return new PluginManifest(schemaVersion, id, name, newVersion, backend, frontend, dependencies, providesCapabilities, requiredCapabilities, description, packaging, runtime);
    }

    /**
     * A dependency: a plugin id, written as a plain string, or {@code { "id": ..., "version": ... }} with a SemVer range in npm syntax (e.g. {@code ^0.20.0}).
     *
     * @param problem why the entry is malformed (an unknown key such as a misspelt {@code version}, or a value that is not a string), or null; manifest validation rejects it. The shared mapper
     * ignores unknown properties, so a typo would otherwise silently drop the version check.
     */
    record Dependency(String id, String version, String problem)
    {

        private static final Set<String> KEYS = Set.of("id", "version");

        Dependency(String id, String version)
        {
            this(id, version, null);
        }

        @JsonCreator(
                mode = JsonCreator.Mode.DELEGATING)
        static Dependency of(Object value)
        {
            if (value instanceof String id)
            {
                return new Dependency(id, null);
            }
            if (value instanceof Map<?, ?> map)
            {
                List<String> unknown = map.keySet()
                        .stream()
                        .map(String::valueOf)
                        .filter(key -> !KEYS.contains(key))
                        .sorted()
                        .toList();
                Object id = map.get("id");
                Object version = map.get("version");
                String problem = !unknown.isEmpty() ? "unknown key(s) " + unknown + ", expected id and version"
                        : (id != null
                                && !(id instanceof String))
                                || (version != null
                                        && !(version instanceof String)) ? "id and version must be strings"
                                                : null;
                return new Dependency(id instanceof String text ? text
                        : null,
                        version instanceof String text ? text
                                : null,
                        problem);
            }
            return new Dependency(null, null, "expected a plugin id or { id, version }, got " + value);
        }
    }

    List<String> providesCapabilitiesOrEmpty()
    {
        return providesCapabilities == null ? List.of()
                : providesCapabilities;
    }

    List<String> requiredCapabilitiesOrEmpty()
    {
        return requiredCapabilities == null ? List.of()
                : requiredCapabilities;
    }

    record BackendTarget(String entrypointClass, String factoryClass, Classpath classpath)
    {
    }

    record FrontendTarget(String entryModule, String moduleFormat, String apiVersion)
    {
    }

    record Classpath(String root, List<String> include)
    {
    }

    record Packaging(Layout layout)
    {
    }

    record Layout(String jarsDir, String typescriptDir)
    {
    }

    record RuntimeTarget(SharedRuntime shared)
    {
    }

    record SharedRuntime(List<String> parentFirstPackagePrefixes, List<NativeLibrary> nativeLibraries, List<SharedArtifact> sharedArtifacts)
    {
    }

    record NativeLibrary(String os, String arch, List<String> searchPaths, List<String> filePatterns, boolean required, String loaderClass)
    {
    }

    record SharedArtifact(String pattern, boolean required)
    {
    }
}
