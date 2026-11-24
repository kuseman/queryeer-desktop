package com.queryeer.backend.plugin.jdbc;

import com.queryeer.backend.queryengine.jdbc.JdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

record DefaultJdbcRuntimeService(JdbcDialectRegistry dialectRegistry, JdbcConnections connections) implements JdbcRuntimeService
{
}
