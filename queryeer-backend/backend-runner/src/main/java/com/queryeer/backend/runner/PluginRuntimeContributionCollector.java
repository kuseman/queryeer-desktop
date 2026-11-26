package com.queryeer.backend.runner;

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

            if (shared.nativeLibraries() != null)
            {
                for (PluginManifest.NativeLibrary nativeLibrary : shared.nativeLibraries())
                {
                    nativeLibraries.add(new NativeLibraryPreloader.Request(manifest.id(), nativeLibrary, source.builtin()));
                }
            }
        }

        return new PluginRuntimeContributions(List.copyOf(parentFirstPrefixes), List.copyOf(nativeLibraries));
    }

    /** @param builtin whether it is a built-in plugin's manifest, not an installed plugin's or a developer folder's */
    record ManifestSource(PluginManifest manifest, Path source, boolean builtin)
    {
        ManifestSource(PluginManifest manifest, Path source)
        {
            this(manifest, source, true);
        }
    }

    /** What plugins contribute to the shared layer. Never a plugin's own classpath: plugins share classes through exports (0.21 removed the last plugin that did otherwise). */
    record PluginRuntimeContributions(List<String> parentFirstPrefixes, List<NativeLibraryPreloader.Request> nativeLibraries)
    {
    }
}
