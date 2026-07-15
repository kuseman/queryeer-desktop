package com.queryeer.backend.plugin.jdbc.sqlite;

import java.util.List;

import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

final class SqliteConnectionSetup
{
    static JdbcConnectionSetupDefinition build()
    {
        return new JdbcConnectionSetupDefinition(List.of(
                new JdbcConnectionFieldDefinition("filePath", "Database File", JdbcConnectionFieldType.TEXT, true, "Path to the SQLite database file (.sqlite, .db, .sqlite3)", List.of(), null, null),
                new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, false, "Optional encryption password for the database", List.of(), null, null)));
    }

    private SqliteConnectionSetup()
    {
    }
}
