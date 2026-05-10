package com.queryeer.backend.queryengine.jdbc.schema;

public record JdbcColumnDefinition(String name, String typeName, String nullable, Integer ordinal, Integer size, Integer precision, Integer scale)
{
}
