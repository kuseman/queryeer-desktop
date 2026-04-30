package com.queryeer.backend.plugin.queryengine.payloadbuilder.jdbc;

import java.util.List;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class PayloadbuilderJdbcBackendPlugin implements BackendPlugin
{
    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor("query.payloadbuilder.jdbc", "Payloadbuilder JDBC Bridge", "0.1.0", List.of("query.payloadbuilder", "query.jdbc"),
                List.of("queryengine.payloadbuilder.jdbc.bridge"), List.of("queryengine.payloadbuilder.catalog", "queryengine.jdbc.connection"));
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        context.logger()
                .info("Activated payloadbuilder jdbc bridge backend plugin");
    }
}
