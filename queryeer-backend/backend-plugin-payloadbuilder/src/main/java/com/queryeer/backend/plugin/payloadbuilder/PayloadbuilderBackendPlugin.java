package com.queryeer.backend.plugin.payloadbuilder;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.apache.commons.io.IOUtils;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

import se.kuseman.payloadbuilder.core.Payloadbuilder;

public final class PayloadbuilderBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(context.config(), context.payloadMapper(), context.services()
                .get(JdbcRuntimeService.class),
                context.services()
                        .get(JdbcSqlEditorServices.class));

        // Register in PluginServiceRegistry so external plugins can contribute catalogs
        context.services()
                .register(com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry.class, registry);

        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(context.config(), context.payloadMapper(), registry, context.services()
                .get(IncrementalParseSessionService.class), new TreeSitterSqlParseFunction());
        context.queryEngines()
                .register(provider);
        context.fileSessions()
                .register(provider);
        context.logger()
                .info("Activated payloadbuilder backend plugin");

        String plbChangeLog = getPayloadbuilderChangeLog();
        if (plbChangeLog != null)
        {
            context.changelogs()
                    .registerChangelog(descriptor.id(), plbChangeLog);
        }
    }

    private String getPayloadbuilderChangeLog()
    {
        try
        {
            return IOUtils.toString(Payloadbuilder.class.getResource("/CHANGELOG.md"), StandardCharsets.UTF_8);
        }
        catch (IOException e)
        {
            return "";
        }
    }
}
