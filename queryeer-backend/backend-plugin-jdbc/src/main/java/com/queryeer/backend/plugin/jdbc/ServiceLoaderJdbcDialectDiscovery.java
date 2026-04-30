package com.queryeer.backend.plugin.jdbc;

import java.util.ServiceLoader;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

final class ServiceLoaderJdbcDialectDiscovery implements JdbcDialectDiscovery
{
    @Override
    public void discoverAndRegister(JdbcDialectRegistry registry, LoggerService logger)
    {
        ClassLoader classLoader = Thread.currentThread()
                .getContextClassLoader();
        ServiceLoader<JdbcDialectContributor> contributors = classLoader == null ? ServiceLoader.load(JdbcDialectContributor.class)
                : ServiceLoader.load(JdbcDialectContributor.class, classLoader);

        for (JdbcDialectContributor contributor : contributors)
        {
            try
            {
                contributor.contribute(registry);
                logger.info("Registered JDBC dialect contributor: " + contributor.getClass()
                        .getName());
            }
            catch (IllegalArgumentException e)
            {
                if (e.getMessage() != null
                        && e.getMessage()
                                .startsWith("dialect already registered:"))
                {
                    logger.warn("Skipped JDBC dialect contributor due to duplicate dialect id: " + contributor.getClass()
                            .getName() + " (" + e.getMessage() + ")");
                    continue;
                }
                throw e;
            }
        }
    }
}
