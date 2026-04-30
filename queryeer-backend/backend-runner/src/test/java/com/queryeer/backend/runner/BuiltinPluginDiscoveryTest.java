package com.queryeer.backend.runner;

import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.core.BackendPlatformServices;

class BuiltinPluginDiscoveryTest
{
    @Test
    void discoversBuiltinPluginsFromManifestDefinitions()
    {
        BuiltinPluginDiscovery discovery = new BuiltinPluginDiscovery(new PluginFactory(), BackendPlatformServices.defaultServices());

        List<DiscoveredPlugin> discovered = discovery.discover();

        Assertions.assertEquals(List.of("query.payloadbuilder", "query.jdbc", "query.payloadbuilder.jdbc"), discovered.stream()
                .map(item -> item.manifest()
                        .id())
                .toList());
        Assertions.assertEquals(List.of("query.payloadbuilder", "query.jdbc"), discovered.get(2)
                .plugin()
                .descriptor()
                .dependencies());
    }
}
