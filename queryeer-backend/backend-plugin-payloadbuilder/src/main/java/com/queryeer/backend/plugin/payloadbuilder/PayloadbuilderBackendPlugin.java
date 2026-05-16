package com.queryeer.backend.plugin.payloadbuilder;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

public final class PayloadbuilderBackendPlugin implements BackendPlugin
{
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
