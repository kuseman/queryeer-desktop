package com.queryeer.backend.runner;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import com.queryeer.backend.api.PluginHostServices;

final class BuiltinPluginDiscovery
{
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;
    private final PluginClassLoaderFactory classLoaderFactory;
    private final Path builtinsDir;
    private final List<URL> sharedLibUrls;
    private final ClassLoader appClassLoader;

    BuiltinPluginDiscovery(PluginFactory pluginFactory, PluginHostServices hostServices, PluginClassLoaderFactory classLoaderFactory, Path builtinsDir, List<URL> sharedLibUrls,
            ClassLoader appClassLoader)
    {
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
        this.classLoaderFactory = classLoaderFactory;
        this.builtinsDir = builtinsDir;
        this.sharedLibUrls = sharedLibUrls;
        this.appClassLoader = appClassLoader;
    }

    List<DiscoveredPlugin> discover()
    {
        return builtinManifests().stream()
                .map(manifest ->
                {
                    Path source = builtinsDir.resolve(manifest.id());
                    if (Files.isDirectory(source))
                    {
                        URLClassLoader classLoader = classLoaderFactory.createClassLoader(source, manifest);
                        return new DiscoveredPlugin(manifest, new PluginManifestBackedPlugin(manifest, pluginFactory.instantiate(manifest, classLoader, source, hostServices)), source, true,
                                classLoader);
                    }
                    URLClassLoader classLoader = createDevFallbackClassLoader();
                    return new DiscoveredPlugin(manifest, new PluginManifestBackedPlugin(manifest, pluginFactory.instantiate(manifest, classLoader, null, hostServices)), null, true, classLoader);
                })
                .toList();
    }

    private URLClassLoader createDevFallbackClassLoader()
    {
        List<URL> urls = new ArrayList<>(sharedLibUrls);
        // In dev mode, also inherit the app classloader URLs so plugin classes
        // are loaded by PluginCL, not via parent-delegation to AppCL.
        // This ensures DriverManager.isDriverAllowed passes because the caller
        // classloader (PluginCL) can directly resolve driver classes from libShared.
        if (appClassLoader instanceof URLClassLoader urlCL)
        {
            urls.addAll(Arrays.asList(urlCL.getURLs()));
        }
        return new PluginClassLoaderFactory.ParentAwarePluginClassLoader(urls.toArray(URL[]::new), classLoaderFactory.sharedLoader());
    }

    private List<PluginManifest> builtinManifests()
    {
        return List.of(
                new PluginManifest(1, "query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0",
                        new PluginManifest.BackendTarget("com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin", null, null, "17"), null, List.of(),
                        List.of("queryengine.execute", "queryengine.invoke", "queryengine.payloadbuilder.catalog"), List.of(), null, null),
                new PluginManifest(1, "query.jdbc", "JDBC Query Engine", "0.1.0", new PluginManifest.BackendTarget("com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin", null, null, "17"), null,
                        List.of(), List.of("queryengine.execute", "queryengine.jdbc.connection"), List.of(), null, null),
                new PluginManifest(1, "query.payloadbuilder.jdbc", "Payloadbuilder JDBC Bridge", "0.1.0",
                        new PluginManifest.BackendTarget("com.queryeer.backend.plugin.queryengine.payloadbuilder.jdbc.PayloadbuilderJdbcBackendPlugin", null, null, "17"), null,
                        List.of("query.payloadbuilder", "query.jdbc"), List.of("queryengine.payloadbuilder.jdbc.bridge"), List.of("queryengine.payloadbuilder.catalog", "queryengine.jdbc.connection"),
                        null, null));
    }
}
