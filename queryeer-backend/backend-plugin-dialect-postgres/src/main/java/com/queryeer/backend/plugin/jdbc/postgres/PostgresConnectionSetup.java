package com.queryeer.backend.plugin.jdbc.postgres;

import java.util.List;

import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

final class PostgresConnectionSetup
{
    static JdbcConnectionSetupDefinition build()
    {
        List<JdbcConnectionFieldOption> sslOptions = List.of(new JdbcConnectionFieldOption("disable", "Disable"), new JdbcConnectionFieldOption("prefer", "Prefer (try SSL, fall back to plain)"),
                new JdbcConnectionFieldOption("require", "Require (enforce TLS)"), new JdbcConnectionFieldOption("verify-ca", "Verify CA (check server certificate)"),
                new JdbcConnectionFieldOption("verify-full", "Verify Full (check CA + hostname)"));

        return new JdbcConnectionSetupDefinition(
                List.of(new JdbcConnectionFieldDefinition("host", "Host", JdbcConnectionFieldType.TEXT, true, "Hostname or IP address of the PostgreSQL server", List.of(), null, null),
                        new JdbcConnectionFieldDefinition("port", "Port", JdbcConnectionFieldType.NUMBER, false, "TCP port (default: 5432)", List.of(), 5432, null),
                        new JdbcConnectionFieldDefinition("database", "Database", JdbcConnectionFieldType.TEXT, true, "Initial database to connect to", List.of(), null, null),
                        new JdbcConnectionFieldDefinition("username", "Username", JdbcConnectionFieldType.TEXT, true, null, List.of(), null, null),
                        new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, true, "Stored in security vault", List.of(), null, null),
                        new JdbcConnectionFieldDefinition("sslMode", "SSL Mode", JdbcConnectionFieldType.SELECT, false, "SSL/TLS mode for the connection", sslOptions, "prefer", null)));
    }

    private PostgresConnectionSetup()
    {
    }
}
