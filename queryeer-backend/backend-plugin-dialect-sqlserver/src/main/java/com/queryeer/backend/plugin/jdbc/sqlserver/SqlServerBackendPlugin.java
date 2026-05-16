package com.queryeer.backend.plugin.jdbc.sqlserver;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

public final class SqlServerBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        JdbcRuntimeService runtimeService = context.services()
                .get(JdbcRuntimeService.class);
        if (runtimeService == null)
        {
            throw new IllegalStateException("JdbcRuntimeService is required before SQL Server dialect activation");
        }
        new SqlServerDialectContributor().contribute(runtimeService.dialectRegistry());
        context.logger()
                .info("Activated SQL Server JDBC dialect plugin");
    }
}
