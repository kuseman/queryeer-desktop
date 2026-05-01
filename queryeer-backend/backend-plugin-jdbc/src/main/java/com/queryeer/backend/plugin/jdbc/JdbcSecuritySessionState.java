package com.queryeer.backend.plugin.jdbc;

import java.util.concurrent.atomic.AtomicBoolean;

final class JdbcSecuritySessionState
{
    private final AtomicBoolean open = new AtomicBoolean(false);

    boolean isOpen()
    {
        return open.get();
    }

    void markOpen()
    {
        open.set(true);
    }

    void markClosed()
    {
        open.set(false);
    }
}
