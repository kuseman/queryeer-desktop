package com.queryeer.backend.plugin.jdbc;

record JdbcSchemaTarget(String database, String schema)
{
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
