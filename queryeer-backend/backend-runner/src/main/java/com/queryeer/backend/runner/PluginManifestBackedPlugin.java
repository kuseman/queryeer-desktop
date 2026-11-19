package com.queryeer.backend.runner;

import java.util.function.Supplier;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

/**
 * A plugin described by its manifest, whose entrypoint is created when the plugin is activated, not when it is discovered. By then every plugin's class loader exists and every kept plugin has
 * published its exports, so an entrypoint that uses another plugin's exported types finds them whatever order the plugins were discovered in. A plugin whose entrypoint cannot be created fails on its
 * own instead of stopping discovery.
 */
final class PluginManifestBackedPlugin implements BackendPlugin
{
    private final PluginManifest manifest;
    private final Instance instance;

    PluginManifestBackedPlugin(PluginManifest manifest, BackendPlugin delegate)
    {
        this(manifest, () -> delegate);
    }

    PluginManifestBackedPlugin(PluginManifest manifest, Supplier<BackendPlugin> factory)
    {
        this(manifest, new Instance(factory));
    }

    private PluginManifestBackedPlugin(PluginManifest manifest, Instance instance)
    {
        this.manifest = manifest;
        this.instance = instance;
    }

    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor(manifest.id(), manifest.name(), manifest.version(), manifest.requiredDependencyIds(), manifest.providesCapabilitiesOrEmpty(),
                manifest.requiredCapabilitiesOrEmpty(), manifest.dependencyVersions(), manifest.optionalDependencyIds());
    }

    /** The same plugin, described by another manifest (e.g. a built-in with the backend's version). */
    PluginManifestBackedPlugin withManifest(PluginManifest newManifest)
    {
        return new PluginManifestBackedPlugin(newManifest, instance);
    }

    /** Whether the entrypoint has been created. */
    boolean isInstantiated()
    {
        return instance.created() != null;
    }

    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor) throws Exception
    {
        instance.get()
                .activate(context, descriptor);
    }

    @Override
    public void deactivate() throws Exception
    {
        BackendPlugin created = instance.created();
        if (created != null)
        {
            created.deactivate();
        }
    }

    /** The entrypoint, created once on first use. */
    private static final class Instance
    {
        private final Supplier<BackendPlugin> factory;
        private volatile BackendPlugin plugin;

        Instance(Supplier<BackendPlugin> factory)
        {
            this.factory = factory;
        }

        synchronized BackendPlugin get()
        {
            if (plugin == null)
            {
                plugin = factory.get();
            }
            return plugin;
        }

        BackendPlugin created()
        {
            return plugin;
        }
    }
}
