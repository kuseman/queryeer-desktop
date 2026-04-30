package com.queryeer.backend.contract.connection;

public record ConnectionUpsertParams(String connectionId, String engineId, String name, Object connection)
{
}
