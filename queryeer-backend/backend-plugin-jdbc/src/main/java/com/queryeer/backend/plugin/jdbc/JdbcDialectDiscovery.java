package com.queryeer.backend.plugin.jdbc;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

interface JdbcDialectDiscovery
{
    void discoverAndRegister(JdbcDialectRegistry registry, LoggerService logger);
}
