package com.queryeer.backend.queryengine.jdbc;

import java.util.List;

public record JdbcConnectionFieldDefinition(String id, String label, JdbcConnectionFieldType type, boolean required, String description, List<JdbcConnectionFieldOption> options, Object defaultValue)
{
}
