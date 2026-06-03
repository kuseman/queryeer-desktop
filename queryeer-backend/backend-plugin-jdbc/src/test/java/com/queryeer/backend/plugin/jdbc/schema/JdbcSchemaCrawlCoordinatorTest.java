package com.queryeer.backend.plugin.jdbc.schema;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.argThat;
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
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

class JdbcSchemaCrawlCoordinatorTest
{
    private static JdbcConnectionHealth health()
    {
        return new JdbcConnectionHealth();
    }

    @Test
    void onUsageRecordsTopAndDeepScopes()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health(), Runnable::run);

        coordinator.onUsage("jdbc-1");

        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.TOP), any(Instant.class));
        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.DEEP), eq(null), any(Instant.class));
    }

    @Test
    void onUsageThrottlesRepeatedEventsForSameConnectionAndDatabase()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health(), Runnable::run);

        coordinator.onUsage("jdbc-1", "db1");
        coordinator.onUsage("jdbc-1", "db1");

        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.TOP), any(Instant.class));
        verify(store, times(1)).recordUsage(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.DEEP), eq("db1"), any(Instant.class));
    }

    @Test
    void onUsageImmediatelyCrawlsDueTopAndSelectedDatabaseDeep()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcConnection connection = mock(JdbcConnection.class);
        when(connections.resolve("jdbc-1")).thenReturn(connection);
        when(connection.connectionId()).thenReturn("jdbc-1");
        when(store.isDue(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.TOP), eq(null), any(Instant.class))).thenReturn(true);
        when(store.isDue(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.DEEP), eq("db1"), any(Instant.class))).thenReturn(true);
        when(store.readState("jdbc-1", JdbcSchemaCrawlScope.TOP, null)).thenReturn(new JdbcSchemaStore.CrawlState(0, 0.0d, true, Instant.EPOCH));
        when(store.readState("jdbc-1", JdbcSchemaCrawlScope.DEEP, "db1")).thenReturn(new JdbcSchemaStore.CrawlState(0, 0.0d, true, Instant.EPOCH));
        when(policy.intervalFor(eq(JdbcSchemaCrawlScope.TOP), anyDouble(), eq(true), eq(0))).thenReturn(java.time.Duration.ofMinutes(1));
        when(policy.intervalFor(eq(JdbcSchemaCrawlScope.DEEP), anyDouble(), eq(true), eq(0))).thenReturn(java.time.Duration.ofMinutes(1));
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health(), Runnable::run);

        coordinator.onUsage("jdbc-1", "db1");

        verify(crawler, times(1)).crawl(connection, JdbcSchemaCrawlScope.TOP, null);
        verify(crawler, times(1)).crawl(eq(connection), eq(JdbcSchemaCrawlScope.DEEP), argThat(target -> "db1".equals(target.database())
                && target.schema() == null));
    }

    @Test
    void onUsageDoesNotForceCrawlWhenNotDue()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcConnection connection = mock(JdbcConnection.class);
        when(connections.resolve("jdbc-1")).thenReturn(connection);
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health(), Runnable::run);

        coordinator.onUsage("jdbc-1", "db1");

        verify(crawler, times(0)).crawl(any(JdbcConnection.class), any(JdbcSchemaCrawlScope.class), any(JdbcSchemaTarget.class));
    }

    @Test
    void refreshDueReturnsCurrentSnapshotAndQueuesDueCrawl()
    {
        DefaultJdbcConnections connections = mock(DefaultJdbcConnections.class);
        JdbcSchemaCrawler crawler = mock(JdbcSchemaCrawler.class);
        JdbcSchemaStore store = mock(JdbcSchemaStore.class);
        JdbcSchemaCrawlPolicy policy = mock(JdbcSchemaCrawlPolicy.class);
        LoggerService logger = mock(LoggerService.class);
        JdbcConnection connection = mock(JdbcConnection.class);
        List<com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject> snapshot = List.of();
        when(connections.resolve("jdbc-1")).thenReturn(connection);
        when(connection.connectionId()).thenReturn("jdbc-1");
        when(store.isDue(eq("jdbc-1"), eq(JdbcSchemaCrawlScope.TOP), eq(null), any(Instant.class))).thenReturn(true);
        when(store.readState("jdbc-1", JdbcSchemaCrawlScope.TOP, null)).thenReturn(new JdbcSchemaStore.CrawlState(0, 0.0d, true, Instant.EPOCH));
        when(store.latestSnapshot("jdbc-1", JdbcSchemaCrawlScope.TOP)).thenReturn(snapshot);
        when(policy.intervalFor(eq(JdbcSchemaCrawlScope.TOP), anyDouble(), eq(true), eq(0))).thenReturn(java.time.Duration.ofMinutes(1));
        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health(), Runnable::run);

        List<com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject> result = coordinator.refreshDue("jdbc-1", JdbcSchemaCrawlScope.TOP, null, false);

        org.junit.jupiter.api.Assertions.assertSame(snapshot, result);
        verify(crawler, times(1)).crawl(connection, JdbcSchemaCrawlScope.TOP, null);
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

        JdbcSchemaCrawlCoordinator coordinator = new JdbcSchemaCrawlCoordinator(connections, crawler, store, policy, logger, health());

        coordinator.refreshNow("jdbc-1", JdbcSchemaCrawlScope.DEEP, null);

        verify(crawler, times(1)).crawl(connection, JdbcSchemaCrawlScope.DEEP, null);
        verify(store, times(1)).latestSnapshot("jdbc-1", JdbcSchemaCrawlScope.DEEP);
    }
}
