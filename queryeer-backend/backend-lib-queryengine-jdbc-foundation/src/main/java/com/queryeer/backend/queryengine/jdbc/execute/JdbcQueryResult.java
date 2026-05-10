package com.queryeer.backend.queryengine.jdbc.execute;

import java.util.Map;

public record JdbcQueryResult(long rowCount, Map<String, Object> engineState)
{
}
