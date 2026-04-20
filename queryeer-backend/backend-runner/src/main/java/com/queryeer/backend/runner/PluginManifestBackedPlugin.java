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
        return new PluginDescriptor(manifest.id(), manifest.name(), manifest.version(), manifest.dependenciesOrEmpty(), manifest.providesCapabilitiesOrEmpty(), manifest.requiredCapabilitiesOrEmpty());
    }

    @Override
    public void activate(BackendPluginContext context) throws Exception
    {
        delegate.activate(context);
    }

    @Override
    public void deactivate() throws Exception
    {
        delegate.deactivate();
    }
}
