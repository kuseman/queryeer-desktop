package com.queryeer.backend.queryengine.jdbc;

import java.util.Map;

public record JdbcQueryResult(long rowCount, Map<String, Object> engineStatePatch)
{
}
