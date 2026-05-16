package com.queryeer.backend.runner;

import java.util.List;

record PluginManifest(int schemaVersion, String id, String name, String version, BackendTarget backend, FrontendTarget frontend, List<String> dependencies, List<String> providesCapabilities,
        List<String> requiredCapabilities, String description, Packaging packaging, RuntimeTarget runtime)
{

    List<String> dependenciesOrEmpty()
    {
        return dependencies == null ? List.of()
                : dependencies;
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
