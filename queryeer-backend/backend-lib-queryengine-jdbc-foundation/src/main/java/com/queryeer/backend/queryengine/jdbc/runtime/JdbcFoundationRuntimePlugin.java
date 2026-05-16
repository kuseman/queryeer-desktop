package com.queryeer.backend.queryengine.jdbc.runtime;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class JdbcFoundationRuntimePlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        context.logger()
                .info("Activated JDBC foundation runtime plugin");
    }
}
