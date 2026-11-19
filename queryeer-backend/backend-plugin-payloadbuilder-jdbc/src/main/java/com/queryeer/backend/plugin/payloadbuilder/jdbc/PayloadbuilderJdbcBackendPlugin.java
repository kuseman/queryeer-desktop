package com.queryeer.backend.plugin.payloadbuilder.jdbc;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry;

/**
 * The built-in plugin {@code queryengine.payloadbuilder.jdbc}: payloadbuilder's {@code jdbc} catalog, over the JDBC engine's connections. It requires both engines and is skipped when either is
 * missing, so payloadbuilder and the JDBC engine each work without the other.
 */
public final class PayloadbuilderJdbcBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        PluginServiceRegistry services = context.services();
        services.require(PayloadbuilderCatalogProviderRegistry.class)
                .registerContributor(new JdbcCatalogProvider(services.require(JdbcRuntimeService.class), services.require(JdbcSqlEditorServices.class)));
        context.logger()
                .info("Activated payloadbuilder jdbc catalog plugin");
    }
}
