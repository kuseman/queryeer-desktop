package com.queryeer.backend.plugin.payloadbuilder;

import java.util.List;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class PayloadbuilderBackendPlugin implements BackendPlugin
{
    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor("query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0", List.of(), List.of("query.execute", "engine.invoke"), List.of());
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        context.queryEngines()
                .register(new PayloadbuilderQueryEngineProvider());
        context.logger()
                .info("Activated payloadbuilder backend plugin");
    }
}
