package com.queryeer.backend.queryengine.jdbc.schema;

public record JdbcSchemaTarget(String database, String schema, String table)
{
    public JdbcSchemaTarget(String database, String schema)
    {
        this(database, schema, null);
    }

    public boolean matches(String candidateDatabase, String candidateSchema)
    {
        if (schema == null
                || schema.isBlank())
        {
            return false;
        }
        if (!schema.equalsIgnoreCase(candidateSchema == null ? ""
                : candidateSchema))
        {
            return false;
        }
        if (database == null
                || database.isBlank())
        {
            return true;
        }
        return database.equalsIgnoreCase(candidateDatabase == null ? ""
                : candidateDatabase);
    }
}
