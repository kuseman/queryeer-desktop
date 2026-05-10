package com.queryeer.backend.queryengine.jdbc.schema;

import java.util.List;
import java.util.Map;

public record JdbcSchemaObject(String id, String name, String kind, List<JdbcSchemaObject> children, Map<String, Object> attributes)
{
}
