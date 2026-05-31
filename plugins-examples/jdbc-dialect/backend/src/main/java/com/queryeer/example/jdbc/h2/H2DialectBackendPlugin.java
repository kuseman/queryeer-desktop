package com.queryeer.example.jdbc.h2;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

public final class H2DialectBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        JdbcRuntimeService runtimeService = context.services()
                .get(JdbcRuntimeService.class);
        if (runtimeService == null)
        {
            throw new IllegalStateException(
                    "JdbcRuntimeService is required before H2 dialect activation");
        }
        new H2DialectContributor().contribute(runtimeService.dialectRegistry());
        context.logger().info("Activated Example H2 JDBC dialect plugin");
    }

    @Override
    public void deactivate()
    {
    }
}
