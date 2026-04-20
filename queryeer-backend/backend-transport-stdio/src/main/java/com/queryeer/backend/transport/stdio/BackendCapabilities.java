package com.queryeer.backend.transport.stdio;

import java.util.List;

final class BackendCapabilities
{
    private BackendCapabilities()
    {
    }

    public static final List<String> HANDSHAKE_SUPPORTED_CAPABILITIES = List.of("backend.runtimeStatus", "health.ping", "query.execute", "query.cancel", "connection.upsert", "credential.store",
            "query.progress", "query.resultChunk", "query.completed", "query.failed");
}
