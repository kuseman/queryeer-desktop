package com.queryeer.backend.plugin.jdbc;

interface JdbcConnectionUsageListener
{
    void onUsage(String connectionId);
}
