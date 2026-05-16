package com.queryeer.backend.queryengine.sql.parser.runtime;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

public final class SqlParserRuntimePlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        context.logger()
                .info("Activated SQL parser runtime plugin");
    }
}
