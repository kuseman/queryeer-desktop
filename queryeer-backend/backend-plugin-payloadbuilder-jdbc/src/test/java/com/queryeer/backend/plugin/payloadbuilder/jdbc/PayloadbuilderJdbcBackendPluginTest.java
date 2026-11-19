package com.queryeer.backend.plugin.payloadbuilder.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry;

class PayloadbuilderJdbcBackendPluginTest
{
    @Test
    void registersTheJdbcCatalogWithPayloadbuilder()
    {
        List<PayloadbuilderCatalogProviderContributor> registered = new ArrayList<>();
        PluginServiceRegistry services = services(registered::add, mock(JdbcRuntimeService.class), mock(JdbcSqlEditorServices.class));

        new PayloadbuilderJdbcBackendPlugin().activate(context(services), mock(PluginDescriptor.class));

        assertEquals(1, registered.size());
        assertEquals("jdbc", registered.get(0)
                .catalogId());
    }

    @Test
    void failsWithWhatToCheckWhenTheJdbcEngineIsMissing()
    {
        PluginServiceRegistry services = services(contributor ->
        {
        }, null, null);

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> new PayloadbuilderJdbcBackendPlugin().activate(context(services), mock(PluginDescriptor.class)));

        assertTrue(error.getMessage()
                .startsWith(JdbcRuntimeService.class.getName() + " is not registered."), error.getMessage());
    }

    private static PluginServiceRegistry services(PayloadbuilderCatalogProviderRegistry registry, JdbcRuntimeService runtime, JdbcSqlEditorServices editor)
    {
        // require() is a default method over get()
        PluginServiceRegistry services = mock(PluginServiceRegistry.class, CALLS_REAL_METHODS);
        when(services.get(PayloadbuilderCatalogProviderRegistry.class)).thenReturn(registry);
        when(services.get(JdbcRuntimeService.class)).thenReturn(runtime);
        when(services.get(JdbcSqlEditorServices.class)).thenReturn(editor);
        return services;
    }

    private static BackendPluginContext context(PluginServiceRegistry services)
    {
        BackendPluginContext context = mock(BackendPluginContext.class);
        when(context.services()).thenReturn(services);
        when(context.logger()).thenReturn(mock(LoggerService.class));
        return context;
    }
}
