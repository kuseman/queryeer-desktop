package com.queryeer.backend.contract.connection;

import java.util.Map;

public record ConnectionUpsertParams(String connectionId, String engineId, String name, String host, Integer port, String database, String username, Map<String, Object> options)
{
}
