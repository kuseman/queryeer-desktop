package com.queryeer.backend.runner;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

final class PluginManifestBackedPlugin implements BackendPlugin
{
    private final PluginManifest manifest;
    private final BackendPlugin delegate;

    PluginManifestBackedPlugin(PluginManifest manifest, BackendPlugin delegate)
    {
        this.manifest = manifest;
        this.delegate = delegate;
    }

    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor(manifest.id(), manifest.name(), manifest.version(), manifest.dependenciesOrEmpty(), manifest.providesCapabilitiesOrEmpty(), manifest.requiredCapabilitiesOrEmpty(),
                manifest.dependencyVersions());
    }

    /** The same plugin, described by another manifest (e.g. a built-in with the backend's version). */
    PluginManifestBackedPlugin withManifest(PluginManifest newManifest)
    {
        return new PluginManifestBackedPlugin(newManifest, delegate);
    }

    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor) throws Exception
    {
        delegate.activate(context, descriptor);
    }

    @Override
    public void deactivate() throws Exception
    {
        delegate.deactivate();
    }
}
