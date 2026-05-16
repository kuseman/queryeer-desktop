package com.queryeer.backend.queryengine.jdbc.runtime;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;

public final class JdbcFoundationRuntimePlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context)
    {
        context.logger()
                .info("Activated JDBC foundation runtime plugin");
    }
}
