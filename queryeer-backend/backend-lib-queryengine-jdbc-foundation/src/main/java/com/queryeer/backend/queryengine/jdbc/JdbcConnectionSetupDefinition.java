package com.queryeer.backend.queryengine.jdbc;

import java.util.List;

public record JdbcConnectionSetupDefinition(List<JdbcConnectionFieldDefinition> fields)
{
}
