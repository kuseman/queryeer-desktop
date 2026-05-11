package com.queryeer.backend.plugin.payloadbuilder;

import java.util.List;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

public final class PayloadbuilderBackendPlugin implements BackendPlugin
{
    @Override
    public PluginDescriptor descriptor()
    {
        //@formatter:off
        return new PluginDescriptor(
                "query.payloadbuilder",
                "Payloadbuilder Query Engine",
                "0.1.0",
                // We need jdbc plugin to exists to access JdbcRuntimeServices
                List.of("query.jdbc"),
                List.of("queryengine.execute", "queryengine.invoke", "queryengine.payloadbuilder.catalog"),
                List.of());
        //@formatter:on
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(context.config(), context.payloadMapper(), context.services()
                .get(JdbcRuntimeService.class),
                context.services()
                        .get(IncrementalParseSessionService.class),
                new TreeSitterSqlParseFunction());
        context.queryEngines()
                .register(provider);
        context.fileSessions()
                .register(provider);
        context.logger()
                .info("Activated payloadbuilder backend plugin");
    }
}
