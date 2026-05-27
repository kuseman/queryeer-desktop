package com.queryeer.backend.plugin.jdbc.postgres;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

public final class PostgresBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        JdbcRuntimeService runtimeService = context.services()
                .get(JdbcRuntimeService.class);
        if (runtimeService == null)
        {
            throw new IllegalStateException("JdbcRuntimeService is required before PostgreSQL dialect activation");
        }
        new PostgresDialectContributor().contribute(runtimeService.dialectRegistry());
        context.logger()
                .info("Activated PostgreSQL JDBC dialect plugin");
    }
}
