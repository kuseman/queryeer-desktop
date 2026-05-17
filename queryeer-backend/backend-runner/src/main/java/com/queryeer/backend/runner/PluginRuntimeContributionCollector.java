package com.queryeer.backend.runner;

import java.net.URL;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class PluginRuntimeContributionCollector
{
    PluginRuntimeContributions collect(List<ManifestSource> manifests)
    {
        Set<String> parentFirstPrefixes = new LinkedHashSet<>(PluginClassLoaderFactory.BASE_PARENT_FIRST_PREFIXES);
        List<URL> sharedClasspath = new ArrayList<>();
        List<NativeLibraryPreloader.Request> nativeLibraries = new ArrayList<>();

        for (ManifestSource source : manifests)
        {
            PluginManifest manifest = source.manifest();
            if (manifest.runtime() == null
                    || manifest.runtime()
                            .shared() == null)
            {
                continue;
            }

            PluginManifest.SharedRuntime shared = manifest.runtime()
                    .shared();
            if (shared.parentFirstPackagePrefixes() != null)
            {
                parentFirstPrefixes.addAll(shared.parentFirstPackagePrefixes());
            }

            if (isSharedRuntimePlugin(manifest)
                    && manifest.backend() != null)
            {
                sharedClasspath.addAll(PluginClassLoaderFactory.resolveClasspath(source.source(), manifest));
            }

            if (shared.nativeLibraries() != null)
            {
                for (PluginManifest.NativeLibrary nativeLibrary : shared.nativeLibraries())
                {
                    nativeLibraries.add(new NativeLibraryPreloader.Request(manifest.id(), nativeLibrary));
                }
            }
        }

        return new PluginRuntimeContributions(List.copyOf(parentFirstPrefixes), List.copyOf(sharedClasspath), List.copyOf(nativeLibraries));
    }

    private boolean isSharedRuntimePlugin(PluginManifest manifest)
    {
        return manifest.id()
                .startsWith("queryengine.runtime.");
    }

    record ManifestSource(PluginManifest manifest, Path source)
    {
    }

    record PluginRuntimeContributions(List<String> parentFirstPrefixes, List<URL> sharedClasspath, List<NativeLibraryPreloader.Request> nativeLibraries)
    {
    }
}
