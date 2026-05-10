package com.queryeer.backend.queryengine.jdbc.setup;

import java.util.List;

public record JdbcConnectionSetupDefinition(List<JdbcConnectionFieldDefinition> fields)
{
}
