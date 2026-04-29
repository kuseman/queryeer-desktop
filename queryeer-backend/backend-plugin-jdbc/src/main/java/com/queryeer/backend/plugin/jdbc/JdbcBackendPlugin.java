package com.queryeer.backend.plugin.jdbc;

import java.util.List;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;

public final class JdbcBackendPlugin implements BackendPlugin
{
    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor("query.jdbc", "JDBC Query Engine", "0.1.0", List.of(), List.of("queryengine.execute"), List.of());
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        context.queryEngines()
                .register(new QueryEngineProvider()
                {
                    @Override
                    public String engineId()
                    {
                        return "jdbc";
                    }

                    @Override
                    public void execute(String queryExecutionId, String text, Object engineState, QueryPublisher publisher)
                    {
                        publisher.failed("INTERNAL", "JDBC execution not yet implemented");
                    }

                    @Override
                    public void cancel(String queryExecutionId)
                    {
                    }
                });
        context.logger()
                .info("Activated jdbc backend plugin");
    }
}
