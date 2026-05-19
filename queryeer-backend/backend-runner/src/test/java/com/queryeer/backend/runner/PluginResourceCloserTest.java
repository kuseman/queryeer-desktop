package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.security.SecuritySession;

class PluginResourceCloserTest
{
    private static SharedClassLoader emptySharedLoader()
    {
        return new SharedClassLoader(List.of(), PluginResourceCloserTest.class.getClassLoader());
    }

    @Test
    void closesDiscoveredPluginClassLoaderResources()
    {
        RecordingCloseable closeable = new RecordingCloseable();
        DiscoveredPlugin discovered = new DiscoveredPlugin(manifest(), plugin(), Path.of("plugins/sample"), true, closeable);

        BackendPlatformServices platformServices = BackendPlatformServices.fileBased(Map.of(), new SecuritySession());

        PluginResourceCloser.closeAll(List.of(discovered), emptySharedLoader(), platformServices.logger());

        Assertions.assertTrue(closeable.closed);
    }

    @Test
    void ignoresPluginsWithoutClassLoaderResources()
    {
        DiscoveredPlugin discovered = new DiscoveredPlugin(manifest(), plugin(), null, false, null);

        BackendPlatformServices platformServices = BackendPlatformServices.fileBased(Map.of(), new SecuritySession());

        Assertions.assertDoesNotThrow(() -> PluginResourceCloser.closeAll(List.of(discovered), emptySharedLoader(), platformServices.logger()));
    }

    private static PluginManifest manifest()
    {
        return new PluginManifest(1, "test.plugin", "Test Plugin", "1.0.0", new PluginManifest.BackendTarget("example.Plugin", null, null), null, List.of(), List.of(), List.of(), null, null, null);
    }

    private static BackendPlugin plugin()
    {
        return new BackendPlugin()
        {
            @Override
            public PluginDescriptor descriptor()
            {
                return new PluginDescriptor("test.plugin", "Test Plugin", "1.0.0", List.of(), List.of(), List.of());
            }

            @Override
            public void activate(BackendPluginContext context, PluginDescriptor descriptor)
            {
            }
        };
    }

    private static final class RecordingCloseable implements AutoCloseable
    {
        private boolean closed;

        @Override
        public void close()
        {
            closed = true;
        }
    }
}
