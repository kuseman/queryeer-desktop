package com.queryeer.backend.plugin.jdbc.sqlite;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

class SqliteBackendPluginTest
{
    @Test
    void activateContributesDialect()
    {
        JdbcDialectRegistry registry = mock(JdbcDialectRegistry.class);
        JdbcRuntimeService runtimeService = mock(JdbcRuntimeService.class);
        when(runtimeService.dialectRegistry()).thenReturn(registry);

        PluginServiceRegistry services = mock(PluginServiceRegistry.class);
        when(services.get(JdbcRuntimeService.class)).thenReturn(runtimeService);

        LoggerService logger = mock(LoggerService.class);
        BackendPluginContext context = mock(BackendPluginContext.class);
        when(context.services()).thenReturn(services);
        when(context.logger()).thenReturn(logger);

        PluginDescriptor descriptor = mock(PluginDescriptor.class);

        SqliteBackendPlugin plugin = new SqliteBackendPlugin();
        plugin.activate(context, descriptor);

        verify(registry).register(argThat(dialect -> "sqlite".equals(dialect.metadata()
                .id())));
        verify(logger).info(eq("Activated SQLite JDBC dialect plugin"));
    }

    @Test
    void activateThrowsWhenJdbcRuntimeServiceIsMissing()
    {
        PluginServiceRegistry services = mock(PluginServiceRegistry.class);
        when(services.get(JdbcRuntimeService.class)).thenReturn(null);

        BackendPluginContext context = mock(BackendPluginContext.class);
        when(context.services()).thenReturn(services);

        PluginDescriptor descriptor = mock(PluginDescriptor.class);

        SqliteBackendPlugin plugin = new SqliteBackendPlugin();
        assertThrows(IllegalStateException.class, () -> plugin.activate(context, descriptor));
    }
}
