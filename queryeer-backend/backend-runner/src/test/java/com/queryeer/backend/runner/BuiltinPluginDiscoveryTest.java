package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.core.BackendPlatformServices;

class BuiltinPluginDiscoveryTest
{
    @Test
    void discoversBuiltinPluginsFromManifestDefinitions()
    {
        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        BuiltinPluginDiscovery discovery = new BuiltinPluginDiscovery(new PluginFactory(), BackendPlatformServices.defaultServices(), classLoaderFactory, Path.of("."), List.of(),
                getClass().getClassLoader());

        List<DiscoveredPlugin> discovered = discovery.discover();

        Assertions.assertEquals(List.of("query.jdbc", "query.payloadbuilder"), discovered.stream()
                .map(item -> item.manifest()
                        .id())
                .toList());
    }
}
