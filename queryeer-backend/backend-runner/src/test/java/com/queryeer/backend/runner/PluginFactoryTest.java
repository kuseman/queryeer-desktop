package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.BackendPluginFactory;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.PluginHostServices;
import com.queryeer.backend.core.BackendPlatformServices;

class PluginFactoryTest
{
    @Test
    void instantiatesBackendPluginFromEntrypointClass()
    {
        PluginFactory pluginFactory = new PluginFactory();
        PluginManifest manifest = new PluginManifest(1, "test.plugin", "Test Plugin", "1.0.0", new PluginManifest.BackendTarget(TestEntrypointPlugin.class.getName(), null, null, "17"), null,
                List.of(), List.of(), List.of(), null, null);

        BackendPlugin plugin = pluginFactory.instantiate(manifest, getClass().getClassLoader(), Path.of("test"), BackendPlatformServices.defaultServices());

        Assertions.assertEquals("entrypoint.plugin", plugin.descriptor()
                .id());
    }

    @Test
    void instantiatesBackendPluginFromFactoryClass()
    {
        PluginFactory pluginFactory = new PluginFactory();
        PluginManifest manifest = new PluginManifest(1, "test.plugin", "Test Plugin", "1.0.0", new PluginManifest.BackendTarget(null, TestPluginFactory.class.getName(), null, "17"), null, List.of(),
                List.of(), List.of(), null, null);

        BackendPlugin plugin = pluginFactory.instantiate(manifest, getClass().getClassLoader(), Path.of("test"), BackendPlatformServices.defaultServices());

        Assertions.assertEquals("factory.plugin", plugin.descriptor()
                .id());
        Assertions.assertTrue(TestFactoryPlugin.loggerInjected);
    }

    public static final class TestEntrypointPlugin implements BackendPlugin
    {
        @Override
        public PluginDescriptor descriptor()
        {
            return new PluginDescriptor("entrypoint.plugin", "Entrypoint", "1.0.0", List.of(), List.of(), List.of());
        }

        @Override
        public void activate(BackendPluginContext context)
        {
        }
    }

    public static final class TestPluginFactory implements BackendPluginFactory
    {
        @Override
        public BackendPlugin create(PluginHostServices services)
        {
            return new TestFactoryPlugin(services);
        }
    }

    public static final class TestFactoryPlugin implements BackendPlugin
    {
        static boolean loggerInjected;

        TestFactoryPlugin(PluginHostServices services)
        {
            loggerInjected = services.logger() != null;
        }

        @Override
        public PluginDescriptor descriptor()
        {
            return new PluginDescriptor("factory.plugin", "Factory", "1.0.0", List.of(), List.of(), List.of());
        }

        @Override
        public void activate(BackendPluginContext context)
        {
        }
    }
}
