package com.queryeer.example.jdbc.h2;

import java.util.List;

import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

final class H2ConnectionSetup
{
    static JdbcConnectionSetupDefinition build()
    {
        List<JdbcConnectionFieldOption> modeOptions = List.of(
                new JdbcConnectionFieldOption("file", "Embedded File"),
                new JdbcConnectionFieldOption("mem", "In-Memory"),
                new JdbcConnectionFieldOption("tcp", "TCP Server"));

        return new JdbcConnectionSetupDefinition(
                List.of(
                        new JdbcConnectionFieldDefinition(
                                "mode", "Connection Mode",
                                JdbcConnectionFieldType.SELECT, true,
                                "How to connect to the H2 database",
                                modeOptions, "file", null),
                        new JdbcConnectionFieldDefinition(
                                "database", "Database",
                                JdbcConnectionFieldType.TEXT, true,
                                "Database name/path (e.g. './mydb', 'mem:test')",
                                List.of(), null, null),
                        new JdbcConnectionFieldDefinition(
                                "port", "Port",
                                JdbcConnectionFieldType.NUMBER, false,
                                "TCP port (default: 9092)",
                                List.of(), 9092, null),
                        new JdbcConnectionFieldDefinition(
                                "username", "Username",
                                JdbcConnectionFieldType.TEXT, false,
                                "Database username",
                                List.of(), null, null),
                        new JdbcConnectionFieldDefinition(
                                "password", "Password",
                                JdbcConnectionFieldType.SECRET, false,
                                "Database password (stored in security vault)",
                                List.of(), null, null)));
    }

    private H2ConnectionSetup()
    {
    }
}
