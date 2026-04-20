package com.queryeer.backend.plugin.devprobe;

import java.util.List;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class DevProbeBackendPlugin implements BackendPlugin
{
    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor("dev.query-probe", "Dev Query Probe", "0.1.0", List.of(), List.of("dev.query.probe"), List.of());
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        context.logger()
                .info("Activated dev query probe backend plugin");
    }
}
