package com.queryeer.backend.plugin.jdbc;

record JdbcSchemaTarget(String database, String schema, String table)
{
    JdbcSchemaTarget(String database, String schema)
    {
        this(database, schema, null);
    }

    boolean matches(String candidateDatabase, String candidateSchema)
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
