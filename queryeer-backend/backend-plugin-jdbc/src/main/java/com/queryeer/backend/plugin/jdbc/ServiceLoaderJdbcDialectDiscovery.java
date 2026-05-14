package com.queryeer.backend.plugin.jdbc;

import java.util.Iterator;
import java.util.ServiceConfigurationError;
import java.util.ServiceLoader;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

final class ServiceLoaderJdbcDialectDiscovery implements JdbcDialectDiscovery
{
    private final ClassLoader dialectClassLoader;

    ServiceLoaderJdbcDialectDiscovery(ClassLoader dialectClassLoader)
    {
        this.dialectClassLoader = dialectClassLoader;
    }

    @Override
    public void discoverAndRegister(JdbcDialectRegistry registry, LoggerService logger)
    {
        Thread current = Thread.currentThread();
        ClassLoader previous = current.getContextClassLoader();
        current.setContextClassLoader(dialectClassLoader);
        try
        {
            ServiceLoader<JdbcDialectContributor> contributors = ServiceLoader.load(JdbcDialectContributor.class, dialectClassLoader);

            Iterator<JdbcDialectContributor> it = contributors.iterator();
            while (true)
            {
                JdbcDialectContributor contributor;
                try
                {
                    if (!it.hasNext())
                    {
                        break;
                    }
                    contributor = it.next();
                }
                catch (ServiceConfigurationError e)
                {
                    logger.warn("Failed to load JDBC dialect contributor (skipping): " + e.getMessage());
                    continue;
                }
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
                catch (Throwable t)
                {
                    logger.warn("JDBC dialect contributor threw unexpected error (skipping): " + contributor.getClass()
                            .getName() + " — " + t);
                }
            }
        }
        finally
        {
            current.setContextClassLoader(previous);
        }
    }
}
