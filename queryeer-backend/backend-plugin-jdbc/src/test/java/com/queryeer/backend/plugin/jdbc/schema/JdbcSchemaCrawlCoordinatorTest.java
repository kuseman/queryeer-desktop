package com.queryeer.backend.plugin.jdbc.schema;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;

class JdbcSchemaCrawlCoordinatorTest
{
    @Test
    void onUsageRecordsTopAndDeepScopes()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger);

        coordinator.onUsage("jdbc-1");

        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.TOP), any(Instant.class));
        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.DEEP), eq(null), any(Instant.class));
    }

    @Test
    void refreshNowDeepWithoutTargetCrawlsAndReturnsSnapshot()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcConnection connection = mock(JdbcConnection.class);
        when(connections.resolve("jdbc-1")).thenReturn(connection);
        when(connection.connectionId()).thenReturn("jdbc-1");
        when(store.readState("jdbc-1", JdbcSchemaCrawlScope.DEEP, null)).thenReturn(new JdbcSchemaStore.CrawlState(0, 0.0d, true, Instant.EPOCH));
        when(policy.intervalFor(eq(JdbcSchemaCrawlScope.DEEP), anyDouble(), eq(true), eq(0))).thenReturn(java.time.Duration.ofMinutes(1));
        when(store.latestSnapshot("jdbc-1", JdbcSchemaCrawlScope.DEEP)).thenReturn(List.of());

        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger);

        coordinator.refreshNow("jdbc-1", JdbcSchemaCrawlScope.DEEP, null);

        verify(crawler, times(1)).crawl(connection, JdbcSchemaCrawlScope.DEEP, null);
        verify(store, times(1)).latestSnapshot("jdbc-1", JdbcSchemaCrawlScope.DEEP);
    }
}
