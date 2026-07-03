package com.queryeer.backend.transport.stdio;

import java.util.List;

final class BackendCapabilities
{
    private BackendCapabilities()
    {
    }

    public static final List<String> HANDSHAKE_SUPPORTED_CAPABILITIES = List.of("backend.runtimeStatus", "security.session.open", "security.session.close", "security.vault.changed", "health.ping",
            "queryengine.execute", "queryengine.cancel", "queryengine.largeValue.read", "queryengine.invoke", "file.open", "file.close", "queryengine.progress", "queryengine.chunkStart",
            "queryengine.chunkRows", "queryengine.completed", "queryengine.failed", "file.change", "settings.module.changed");
}
